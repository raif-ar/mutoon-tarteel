#import "OrtRunner.h"

#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <onnxruntime/onnxruntime_cxx_api.h>

static NSString *const kDomain = @"ReciteListener";

static NSError *MakeError(NSString *message) {
  return [NSError errorWithDomain:kDomain code:1 userInfo:@{NSLocalizedDescriptionKey : message}];
}

static size_t ElementSize(ONNXTensorElementDataType type) {
  switch (type) {
    case ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT: return 4;
    case ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64: return 8;
    case ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32: return 4;
    default: return 0;
  }
}

@implementation OrtRunner {
  std::unique_ptr<Ort::Env> _env;
  std::unique_ptr<Ort::Session> _session;
  // Input i of the session is either the feature input (`_xIndex`) or a state.
  std::vector<std::string> _inputNames;
  std::vector<std::string> _outputNames;
  std::vector<const char *> _inputNamePtrs;
  std::vector<const char *> _outputNamePtrs;
  std::vector<std::vector<int64_t>> _inputShapes;
  std::vector<ONNXTensorElementDataType> _inputTypes;
  /// For input i, the index of the output that feeds it on the next step (-1 for `x`).
  std::vector<int> _nextFrom;
  std::vector<Ort::Value> _states; // same indexing as inputs; slot `_xIndex` is unused
  size_t _xIndex;
  int _logProbsIndex;
}

- (nullable instancetype)initWithModelPath:(NSString *)path threads:(NSInteger)threads error:(NSError **)error {
  self = [super init];
  if (!self) return nil;
  try {
    _env = std::make_unique<Ort::Env>(ORT_LOGGING_LEVEL_WARNING, "recite-listener");
    Ort::SessionOptions options;
    options.SetIntraOpNumThreads((int)MAX(1, threads));
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
    _session = std::make_unique<Ort::Session>(*_env, path.UTF8String, options);

    Ort::AllocatorWithDefaultOptions allocator;
    const size_t nIn = _session->GetInputCount();
    const size_t nOut = _session->GetOutputCount();
    _xIndex = SIZE_MAX;
    _logProbsIndex = -1;
    for (size_t i = 0; i < nOut; i++) {
      _outputNames.emplace_back(_session->GetOutputNameAllocated(i, allocator).get());
      if (_outputNames.back() == "log_probs") _logProbsIndex = (int)i;
    }
    for (size_t i = 0; i < nIn; i++) {
      _inputNames.emplace_back(_session->GetInputNameAllocated(i, allocator).get());
      // Keep the TypeInfo alive: the tensor info below is only a view into it.
      Ort::TypeInfo typeInfo = _session->GetInputTypeInfo(i);
      auto info = typeInfo.GetTensorTypeAndShapeInfo();
      std::vector<int64_t> shape = info.GetShape();
      for (auto &d : shape) if (d < 0) d = 1;
      _inputShapes.push_back(shape);
      _inputTypes.push_back(info.GetElementType());
      int from = -1;
      if (_inputNames.back() == "x") {
        _xIndex = i;
      } else {
        const std::string want = "new_" + _inputNames.back();
        for (size_t o = 0; o < nOut; o++) if (_outputNames[o] == want) from = (int)o;
        if (from < 0) {
          if (error) *error = MakeError([NSString stringWithFormat:@"Model has no output for state %s", _inputNames.back().c_str()]);
          return nil;
        }
        if (ElementSize(_inputTypes.back()) == 0) {
          if (error) *error = MakeError([NSString stringWithFormat:@"Unsupported state type for %s", _inputNames.back().c_str()]);
          return nil;
        }
      }
      _nextFrom.push_back(from);
    }
    if (_xIndex == SIZE_MAX || _logProbsIndex < 0 || _inputShapes[_xIndex].size() != 3) {
      if (error) *error = MakeError(@"Model is not a streaming listener (needs input x and output log_probs)");
      return nil;
    }
    for (auto &n : _inputNames) _inputNamePtrs.push_back(n.c_str());
    for (auto &n : _outputNames) _outputNamePtrs.push_back(n.c_str());
    _window = (NSInteger)_inputShapes[_xIndex][1];
    _mels = (NSInteger)_inputShapes[_xIndex][2];
    Ort::TypeInfo outInfo = _session->GetOutputTypeInfo((size_t)_logProbsIndex);
    auto outShape = outInfo.GetTensorTypeAndShapeInfo().GetShape();
    _vocab = outShape.empty() ? 0 : (NSInteger)outShape.back();
    [self reset];
  } catch (const Ort::Exception &e) {
    if (error) *error = MakeError([NSString stringWithFormat:@"ONNX Runtime: %s", e.what()]);
    return nil;
  } catch (const std::exception &e) {
    if (error) *error = MakeError([NSString stringWithFormat:@"%s", e.what()]);
    return nil;
  }
  return self;
}

- (void)reset {
  Ort::AllocatorWithDefaultOptions allocator;
  _states.clear();
  for (size_t i = 0; i < _inputNames.size(); i++) {
    if (i == _xIndex) {
      _states.emplace_back(nullptr);
      continue;
    }
    const auto &shape = _inputShapes[i];
    Ort::Value v = Ort::Value::CreateTensor(allocator, shape.data(), shape.size(), _inputTypes[i]);
    size_t count = 1;
    for (auto d : shape) count *= (size_t)d;
    std::memset(v.GetTensorMutableRawData(), 0, count * ElementSize(_inputTypes[i]));
    _states.push_back(std::move(v));
  }
}

- (nullable NSData *)runWithInput:(NSData *)x error:(NSError **)error {
  const size_t expected = (size_t)_window * (size_t)_mels * sizeof(float);
  if (x.length != expected) {
    if (error) *error = MakeError([NSString stringWithFormat:@"Expected %zu bytes of features, got %lu", expected, (unsigned long)x.length]);
    return nil;
  }
  try {
    Ort::MemoryInfo cpu = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    const auto &xShape = _inputShapes[_xIndex];
    // ONNX Runtime does not write to inputs; the const cast only satisfies the API.
    Ort::Value xValue = Ort::Value::CreateTensor<float>(cpu, const_cast<float *>((const float *)x.bytes),
                                                       (size_t)_window * (size_t)_mels, xShape.data(), xShape.size());
    std::vector<Ort::Value> inputs;
    inputs.reserve(_inputNames.size());
    for (size_t i = 0; i < _inputNames.size(); i++) {
      if (i == _xIndex) inputs.push_back(std::move(xValue));
      else inputs.push_back(std::move(_states[i]));
    }
    std::vector<Ort::Value> outputs = _session->Run(Ort::RunOptions{nullptr}, _inputNamePtrs.data(), inputs.data(), inputs.size(),
                                                    _outputNamePtrs.data(), _outputNamePtrs.size());
    for (size_t i = 0; i < _inputNames.size(); i++) {
      if (i == _xIndex) continue;
      _states[i] = std::move(outputs[(size_t)_nextFrom[i]]);
    }
    Ort::Value &lp = outputs[(size_t)_logProbsIndex];
    const size_t count = lp.GetTensorTypeAndShapeInfo().GetElementCount();
    return [NSData dataWithBytes:lp.GetTensorData<float>() length:count * sizeof(float)];
  } catch (const Ort::Exception &e) {
    // The state tensors were moved into the failed call: start from a clean state.
    [self reset];
    if (error) *error = MakeError([NSString stringWithFormat:@"ONNX Runtime: %s", e.what()]);
    return nil;
  } catch (const std::exception &e) {
    [self reset];
    if (error) *error = MakeError([NSString stringWithFormat:@"%s", e.what()]);
    return nil;
  }
}

@end
