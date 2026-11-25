import ExpoModulesCore

/// Bridges the listener model runner to JS. All model work happens on one
/// serial queue, off the JS and main threads.
public class ReciteListenerModule: Module {
  private var runner: OrtRunner?
  private let queue = DispatchQueue(label: "app.mutoon.recite.listener", qos: .userInitiated)

  #if targetEnvironment(simulator)
  private static let isSimulator = true
  #else
  private static let isSimulator = false
  #endif

  public func definition() -> ModuleDefinition {
    Name("ReciteListener")

    // Lets the app offer its file-audio test hook on the simulator, which has no usable mic.
    Constants([
      "isSimulator": ReciteListenerModule.isSimulator
    ])

    AsyncFunction("load") { (path: String, threads: Int) -> [String: Int] in
      var filePath = path
      if filePath.hasPrefix("file://") {
        filePath = String(filePath.dropFirst("file://".count))
      }
      filePath = filePath.removingPercentEncoding ?? filePath
      let runner = try OrtRunner(modelPath: filePath, threads: threads)
      self.runner = runner
      return ["vocab": runner.vocab, "window": runner.window, "mels": runner.mels]
    }
    .runOnQueue(queue)

    AsyncFunction("run") { (x: Data) -> Data in
      guard let runner = self.runner else {
        throw Exception(name: "ERR_LISTENER_NOT_LOADED", description: "The listener model is not loaded")
      }
      return try runner.run(withInput: x)
    }
    .runOnQueue(queue)

    AsyncFunction("reset") {
      self.runner?.reset()
    }
    .runOnQueue(queue)

    AsyncFunction("release") {
      self.runner = nil
    }
    .runOnQueue(queue)
  }
}
