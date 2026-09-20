import Foundation
import WebKit

/// Captures the activation in the document's bridge before application JavaScript runs.
final class DocumentReadyBridge {
  private var script: WKUserScript?

  static func source(activationId: String) throws -> String {
    let quotedId = String(data: try JSONEncoder().encode(activationId), encoding: .utf8)!
    return """
    (() => {
      if (window !== window.top) return;
      const cap = window.Capacitor;
      if (!cap || typeof cap.toNative !== 'function') return;
      const original = cap.toNative;
      const activationId = \(quotedId);
      cap.toNative = function(plugin, method, options, callback) {
        if (plugin === 'OtaKit' && method === 'notifyAppReady') {
          options = Object.assign({}, options, { _otakitActivationId: activationId });
        }
        return original.call(this, plugin, method, options, callback);
      };
    })();
    """
  }

  func install(on webView: WKWebView, activationId: String) throws {
    precondition(Thread.isMainThread)
    let controller = webView.configuration.userContentController
    let replacement = WKUserScript(
      source: try Self.source(activationId: activationId),
      injectionTime: .atDocumentStart, forMainFrameOnly: true
    )
    // WebKit has no individual removal API. Preserve every other plugin's scripts and order.
    if let script {
      let retained = controller.userScripts.filter { $0 !== script }
      controller.removeAllUserScripts()
      for retainedScript in retained { controller.addUserScript(retainedScript) }
    }
    controller.addUserScript(replacement)
    script = replacement
  }
}
