import Capacitor
import Foundation
import UIKit
import WebKit
import XCTest
@testable import UpdaterPlugin

final class DocumentReadyBridgeTests: XCTestCase {
  @MainActor
  func testOldWebViewDocumentCannotConfirmReplacementUsingCapacitorBridge() async throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    let oldTrial = try XCTUnwrap(fixture.trial)

    let configuration = WKWebViewConfiguration()
    let controller = configuration.userContentController
    let recorder = ReadyMessageRecorder()
    controller.add(recorder, name: "bridge")
    let capacitorBundle = Bundle(for: CAPBridgeViewController.self)
    let nativeBridgeURL = try XCTUnwrap(capacitorBundle.url(forResource: "native-bridge", withExtension: "js"))
    let nativeBridge = try String(contentsOf: nativeBridgeURL, encoding: .utf8)
    controller.addUserScript(WKUserScript(source: nativeBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    controller.addUserScript(WKUserScript(source: "window.otherPluginMarker = 42;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480), configuration: configuration)
    let navigation = ReadyNavigationRecorder()
    webView.navigationDelegate = navigation
    let window: UIWindow
    if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
      window = UIWindow(windowScene: scene)
    } else {
      window = UIWindow(frame: webView.frame)
    }
    let host = UIViewController()
    host.view.addSubview(webView)
    window.rootViewController = host
    window.makeKeyAndVisible()
    defer { window.isHidden = true; webView.removeFromSuperview() }
    let readinessBridge = DocumentReadyBridge()
    try readinessBridge.install(on: webView, activationId: oldTrial.activationId)
    let readyJS = "Capacitor.nativePromise('OtaKit', 'notifyAppReady', {}).catch(() => {});"
    let html = "<html><script>\(readyJS)</script></html>"

    let firstReady = expectation(description: "Original document sends readiness")
    recorder.onReady = { firstReady.fulfill() }
    webView.loadHTMLString(html, baseURL: URL(string: "https://localhost"))
    // Cold simulator WebKit startup is separate from the updater's readiness budget.
    await fulfillment(of: [firstReady], timeout: 30)
    guard recorder.activationId != nil else {
      XCTFail("Initial WebView load: \(navigation.status); bridge messages: \(recorder.lastMessage)")
      return
    }
    XCTAssertEqual(recorder.activationId, oldTrial.activationId)

    try fixture.apply("B")
    let newTrial = try XCTUnwrap(fixture.trial)
    try readinessBridge.install(on: webView, activationId: newTrial.activationId)
    XCTAssertEqual(controller.userScripts.count, 3, "Keep other plugins and replace only our script")
    let staleReady = expectation(description: "Old document calls after preparing replacement")
    recorder.onReady = { staleReady.fulfill() }
    _ = try await webView.evaluateJavaScript(readyJS + "'sent';")
    await fulfillment(of: [staleReady], timeout: 30)
    XCTAssertEqual(recorder.activationId, oldTrial.activationId)
    XCTAssertNil(try fixture.coordinator.prepareNotifyAppReady(activationId: recorder.activationId).eventPayload)
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .trial)
    XCTAssertTrue(fixture.indexExists("A"))

    let replacementReady = expectation(description: "Replacement document gets its own activation")
    recorder.onReady = { replacementReady.fulfill() }
    webView.loadHTMLString(html, baseURL: URL(string: "https://localhost"))
    await fulfillment(of: [replacementReady], timeout: 30)
    XCTAssertEqual(recorder.activationId, newTrial.activationId)
    XCTAssertNotNil(try fixture.coordinator.prepareNotifyAppReady(activationId: recorder.activationId).eventPayload)
    let marker = try await webView.evaluateJavaScript("window.otherPluginMarker") as? Int
    XCTAssertEqual(marker, 42)
    webView.stopLoading()
    controller.removeScriptMessageHandler(forName: "bridge")
  }
}

private final class ReadyMessageRecorder: NSObject, WKScriptMessageHandler {
  var activationId: String?
  var onReady: (() -> Void)?
  var lastMessage = "none"

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    lastMessage = String(describing: message.body)
    guard let body = message.body as? [String: Any],
          body["methodName"] as? String == "notifyAppReady" else { return }
    activationId = (body["options"] as? [String: Any])?["_otakitActivationId"] as? String
    onReady?()
  }
}

private final class ReadyNavigationRecorder: NSObject, WKNavigationDelegate {
  var status = "not started"
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { status = "started" }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { status = "finished" }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { status = "failed: \(error)" }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { status = "provisional failure: \(error)" }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { status = "content process terminated" }
}
