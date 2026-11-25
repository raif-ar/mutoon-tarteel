#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// One ONNX Runtime session for the streaming listener model. The model's
/// recurrent state tensors live here and are fed back on every step.
/// Not thread-safe: call from one serial queue.
@interface OrtRunner : NSObject

- (nullable instancetype)initWithModelPath:(NSString *)path
                                   threads:(NSInteger)threads
                                     error:(NSError **)error;

/// Size of the last dimension of `log_probs` (blank + phoneme tokens).
@property (nonatomic, readonly) NSInteger vocab;
/// Filterbank frames per step and mel bins, from the model's `x` input.
@property (nonatomic, readonly) NSInteger window;
@property (nonatomic, readonly) NSInteger mels;

/// Zero the streaming state.
- (void)reset;

/// One step: `x` is window x mels float32. Returns frames x vocab float32 log-probabilities.
- (nullable NSData *)runWithInput:(NSData *)x error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
