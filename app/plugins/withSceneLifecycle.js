/**
 * Start the app through a UIScene instead of the app delegate's window.
 *
 * iOS 27 stops apps built with the iOS 27 SDK at launch when they have not adopted the scene
 * lifecycle (UIKit's "NoSceneLifecycleAdoption" trap, seen on build 1.0.2 (2)). The Expo SDK 56
 * template still creates the window in the app delegate, so this plugin:
 *   - declares a single window scene in Info.plist,
 *   - adds SceneDelegate.swift, which creates the window and starts React Native in it,
 *   - removes the window creation from AppDelegate.swift (the React Native factory stays there).
 * Deep links arrive through the scene and are passed to React Native's linking manager.
 */
const fs = require("fs");
const path = require("path");
const { withInfoPlist, withAppDelegate, withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const SCENE_DELEGATE = `import UIKit
import React

/** Creates the window for the app's one scene and starts React Native in it (see plugins/withSceneLifecycle.js). */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    // A link that opened the app is read by React Native as the initial URL.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  // Links while the app is running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

const WINDOW_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\([\s\S]*?\)\s*\n#endif\n/;

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return c;
  });

  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") throw new Error("withSceneLifecycle: expected a Swift AppDelegate");
    const src = c.modResults.contents;
    if (src.includes("// The window is created by SceneDelegate")) return c;
    if (!WINDOW_BLOCK.test(src)) throw new Error("withSceneLifecycle: AppDelegate window block not found; the Expo template changed");
    c.modResults.contents = src.replace(WINDOW_BLOCK, "    // The window is created by SceneDelegate (plugins/withSceneLifecycle.js).\n");
    return c;
  });

  config = withDangerousMod(config, [
    "ios",
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
      fs.writeFileSync(path.join(dir, "SceneDelegate.swift"), SCENE_DELEGATE);
      return c;
    },
  ]);

  config = withXcodeProject(config, (c) => {
    const name = c.modRequest.projectName;
    const filepath = `${name}/SceneDelegate.swift`;
    if (!c.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project: c.modResults });
    }
    return c;
  });

  return config;
};
