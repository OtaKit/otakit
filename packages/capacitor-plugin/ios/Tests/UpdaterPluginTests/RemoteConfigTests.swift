import Foundation
import XCTest
@testable import UpdaterPlugin

/// Remote config (plugin 3.4+). The three files are shared with
/// console/lib/manifest-signing.test.ts and RemoteConfigTest.java: a channel's
/// config, a base config with experiments, and a signed deletion.
final class RemoteConfigTests: XCTestCase {
  private static let appId = "7bb828f1-797c-4d07-8254-068cac664f69"
  private static let key = ManifestKey(
    kid: "config-test-key",
    derData: Data(base64Encoded: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJP8NHG8t4uUu8RVw+lnnn7J3YJMMM2deHqJxIZo5O1PlZF7qB24YJ83c2Tv9fyh7fEQirqhkEs+/pBK/2kbCWQ==")!
  )
  static let production = #"""
{"appId": "7bb828f1-797c-4d07-8254-068cac664f69", "channel": "production", "version": 12, "deleted": false, "valuesJson": "{\"checkoutEnabled\":false,\"helpUrl\":\"https://example.com/help\",\"banner\":\"Zurück um 14:00 ✓\",\"limits\":{\"upload\":25}}", "experimentsJson": null, "updatedAt": "2026-10-14T09:00:00.000Z", "signature": {"kid": "config-test-key", "sig": "MEQCIGKAWvjrlu5QVltyCqufCS3j8Zre2H7UTTdmWJVTKv6AAiB3ciiNfJvV5ECQ921CICtxqkreY_BqXvzmSAssbeJ2xQ", "iat": 1790000000, "exp": 2145916800}}
"""#
  static let base = #"""
{"appId": "7bb828f1-797c-4d07-8254-068cac664f69", "channel": null, "version": 3, "deleted": false, "valuesJson": "{\"paywallTitle\":\"Go Pro\",\"maxItems\":5}", "experimentsJson": "[{\"key\":\"paywall_copy\",\"traffic\":100,\"variants\":[{\"key\":\"control\",\"weight\":50,\"overrides\":{}},{\"key\":\"b\",\"weight\":50,\"overrides\":{\"paywallTitle\":\"Unlock everything\"}}],\"runtimeVersions\":null,\"goal\":\"purchase_completed\"}]", "updatedAt": "2026-10-14T09:00:00.000Z", "signature": {"kid": "config-test-key", "sig": "MEUCIFMd1Xs9YBZdJTqjxHwH-rye9EpZQ8y_6t2hh-jZ0KqMAiEA9O5vqX-pGvezd8i3V3-_JpZh6-7GYdW5BzHZnD5JOZs", "iat": 1790000000, "exp": 2145916800}}
"""#
  static let betaDeleted = #"""
{"appId": "7bb828f1-797c-4d07-8254-068cac664f69", "channel": "beta", "version": 14, "deleted": true, "valuesJson": "{}", "experimentsJson": null, "updatedAt": "2026-10-14T09:00:00.000Z", "signature": {"kid": "config-test-key", "sig": "MEQCIFaQbv-YUZmF2TRAaRjDDoPfVJc78Sl2I66w3QIHhWF7AiB3iKMXz4PsB59qBK5Mca1tMKRXyxI4VPiAJ8aHq9b2XQ", "iat": 1790000000, "exp": 2145916800}}
"""#

  private func parse(
    _ json: String,
    channel: String?,
    appId: String = RemoteConfigTests.appId,
    keys: [ManifestKey] = [RemoteConfigTests.key]
  ) throws -> RemoteConfigFile {
    try RemoteConfigParser.parse(
      data: Data(json.utf8),
      appId: appId,
      channel: channel,
      trustedKeys: keys
    )
  }

  private func tampered(_ json: String, _ transform: (inout [String: Any]) -> Void) -> String {
    var object = try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
    transform(&object)
    return String(data: try! JSONSerialization.data(withJSONObject: object), encoding: .utf8)!
  }

  func testVerifiesTheSharedVectors() throws {
    let production = try parse(RemoteConfigTests.production, channel: "production")
    XCTAssertEqual(production.version, 12)
    XCTAssertFalse(production.deleted)
    XCTAssertEqual(
      production.valuesJson,
      #"{"checkoutEnabled":false,"helpUrl":"https://example.com/help","banner":"Zurück um 14:00 ✓","limits":{"upload":25}}"#
    )
    XCTAssertNil(production.experimentsJson)

    let base = try parse(RemoteConfigTests.base, channel: nil)
    XCTAssertNil(base.channel)
    XCTAssertEqual(base.version, 3)
    XCTAssertTrue(base.experimentsJson?.hasPrefix(#"[{"key":"paywall_copy""#) ?? false)

    let deleted = try parse(RemoteConfigTests.betaDeleted, channel: "beta")
    XCTAssertTrue(deleted.deleted)
    XCTAssertEqual(deleted.version, 14)
  }

  func testRefusesTamperedOrMisplacedFiles() {
    let cases: [(String, String?, String)] = [
      (tampered(RemoteConfigTests.production) { $0["valuesJson"] = #"{"checkoutEnabled":true}"# }, "production", "values"),
      (tampered(RemoteConfigTests.production) { $0["version"] = 13 }, "production", "version"),
      (tampered(RemoteConfigTests.betaDeleted) { $0["deleted"] = false }, "beta", "revived deletion"),
      (tampered(RemoteConfigTests.base) { $0["experimentsJson"] = NSNull() }, nil, "experiments"),
      (tampered(RemoteConfigTests.production) { $0.removeValue(forKey: "signature") }, "production", "unsigned"),
      (RemoteConfigTests.production, "beta", "other channel"),
      (RemoteConfigTests.production, nil, "base channel"),
    ]
    for (json, channel, label) in cases {
      XCTAssertThrowsError(try parse(json, channel: channel), label)
    }
    XCTAssertThrowsError(
      try parse(RemoteConfigTests.production, channel: "production", appId: "other-app")
    ) { XCTAssertEqual($0 as? RemoteConfigError, .wrongApp) }
  }

  func testChecksShapeAndSize() {
    let notObject = tampered(RemoteConfigTests.production) { $0["valuesJson"] = "[1,2]" }
    XCTAssertThrowsError(try parse(notObject, channel: "production", keys: [])) {
      XCTAssertEqual($0 as? RemoteConfigError, .invalidValues)
    }
    let badExperiments = tampered(RemoteConfigTests.base) { $0["experimentsJson"] = "{}" }
    XCTAssertThrowsError(try parse(badExperiments, channel: nil, keys: [])) {
      XCTAssertEqual($0 as? RemoteConfigError, .invalidExperiments)
    }
    let huge = Data(repeating: 0x20, count: RemoteConfigParser.maxBytes + 1)
    XCTAssertThrowsError(
      try RemoteConfigParser.parse(data: huge, appId: RemoteConfigTests.appId, channel: nil, trustedKeys: [])
    ) { XCTAssertEqual($0 as? RemoteConfigError, .tooLarge) }
    // Without keys (self-hosted, intentionally unsigned) a well-formed file is accepted.
    let unsigned = tampered(RemoteConfigTests.production) { $0.removeValue(forKey: "signature") }
    XCTAssertNoThrow(try parse(unsigned, channel: "production", keys: []))
  }
}

/// Answers config requests from a table, recording what was asked.
final class ConfigStubProtocol: URLProtocol {
  struct Reply {
    let status: Int
    let body: String
    let etag: String?
  }
  static var replies: [String: [Reply]] = [:]
  static var requests: [URLRequest] = []
  static let lock = NSLock()

  static func reset() {
    lock.lock(); replies = [:]; requests = []; lock.unlock()
  }

  /// Every later request for `path` gets this reply, until the next call.
  static func reply(_ path: String, _ status: Int, _ body: String = "", etag: String? = nil) {
    lock.lock(); replies[path] = [Reply(status: status, body: body, etag: etag)]; lock.unlock()
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    ConfigStubProtocol.lock.lock()
    ConfigStubProtocol.requests.append(request)
    let path = request.url?.path ?? ""
    let reply = ConfigStubProtocol.replies[path]?.first ?? Reply(status: 500, body: "no stub", etag: nil)
    ConfigStubProtocol.lock.unlock()

    var headers: [String: String] = [:]
    if let etag = reply.etag { headers["ETag"] = etag }
    let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

final class RemoteConfigClientTests: XCTestCase {
  private static let appId = "7bb828f1-797c-4d07-8254-068cac664f69"
  private static let key = ManifestKey(kid: "config-test-key", derData: Data(base64Encoded: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJP8NHG8t4uUu8RVw+lnnn7J3YJMMM2deHqJxIZo5O1PlZF7qB24YJ83c2Tv9fyh7fEQirqhkEs+/pBK/2kbCWQ==")!)
  private let basePath = "/config/7bb828f1-797c-4d07-8254-068cac664f69/__base__/config.json"
  private let productionPath = "/config/7bb828f1-797c-4d07-8254-068cac664f69/production/config.json"
  private let betaPath = "/config/7bb828f1-797c-4d07-8254-068cac664f69/beta/config.json"
  private var directory: URL!

  override func setUp() {
    super.setUp()
    ConfigStubProtocol.reset()
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
  }

  override func tearDown() {
    try? FileManager.default.removeItem(at: directory)
    super.tearDown()
  }

  private func client() -> RemoteConfigClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ConfigStubProtocol.self]
    return RemoteConfigClient(store: RemoteConfigStore(directory: directory), session: URLSession(configuration: configuration))
  }

  private func context(_ channel: String?) -> RemoteConfigClient.Context {
    RemoteConfigClient.Context(
      cdnUrl: "https://cdn.test",
      appId: RemoteConfigClientTests.appId,
      channel: channel,
      trustedKeys: [RemoteConfigClientTests.key],
      allowInsecureUrls: false
    )
  }

  func testReadsTheChannelConfigAndPersistsIt() async throws {
    ConfigStubProtocol.reply(productionPath, 200, RemoteConfigTests.production, etag: "\"v12\"")
    let first = client()
    let empty = await first.snapshot(appId: RemoteConfigClientTests.appId, channel: "production")
    XCTAssertNil(empty.file)
    XCTAssertEqual(empty.toDictionary()["source"] as? String, "none")

    let result = await first.refresh(context("production")).result
    XCTAssertNil(result.error)
    XCTAssertTrue(result.changed)
    XCTAssertEqual(result.snapshot.file?.version, 12)
    XCTAssertEqual(result.snapshot.toDictionary()["source"] as? String, "remote")
    XCTAssertEqual(result.snapshot.toDictionary()["channel"] as? String, "production")

    // A new process reads the saved copy without the network.
    let restarted = await client().snapshot(appId: RemoteConfigClientTests.appId, channel: "production")
    XCTAssertEqual(restarted.file?.version, 12)
    XCTAssertEqual(restarted.toDictionary()["source"] as? String, "cache")

    // An unchanged file is confirmed with the ETag.
    ConfigStubProtocol.reply(productionPath, 304)
    let again = await first.refresh(context("production")).result
    XCTAssertFalse(again.changed)
    XCTAssertEqual(ConfigStubProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "\"v12\"")
  }

  func testFallsBackToTheBaseConfigWithoutChannelConfig() async throws {
    ConfigStubProtocol.reply(betaPath, 404)
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    let result = await client().refresh(context("beta")).result
    XCTAssertEqual(result.snapshot.file?.version, 3)
    XCTAssertNil(result.snapshot.file?.channel)
    XCTAssertNotNil(result.snapshot.file?.experimentsJson)
    XCTAssertEqual(ConfigStubProtocol.requests.map { $0.url!.path }, [betaPath, basePath])
  }

  func testASignedDeletionSendsTheChannelToTheBaseConfig() async throws {
    ConfigStubProtocol.reply(betaPath, 200, RemoteConfigTests.betaDeleted)
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    let configClient = client()
    let result = await configClient.refresh(context("beta")).result
    XCTAssertEqual(result.snapshot.file?.version, 3)
    XCTAssertNil(result.snapshot.file?.channel)

    // Without any base config, a deleted channel has no config at all.
    ConfigStubProtocol.reset()
    ConfigStubProtocol.reply(betaPath, 200, RemoteConfigTests.betaDeleted)
    ConfigStubProtocol.reply(basePath, 404)
    let none = await client().refresh(context("beta")).result
    XCTAssertNotNil(none.snapshot.file, "the base copy saved by the first client is kept")
  }

  func testRefusesAnOlderVersionThanOneItAccepted() async throws {
    let older = RemoteConfigTests.production.replacingOccurrences(of: "\"version\": 12", with: "\"version\": 11")
    ConfigStubProtocol.reply(productionPath, 200, RemoteConfigTests.production)
    let configClient = client()
    _ = await configClient.refresh(context("production")).result
    // Version 11 with the version-12 signature would fail verification anyway;
    // an unsigned setup shows the replay rule on its own.
    ConfigStubProtocol.reply(productionPath, 200, older)
    let unsigned = RemoteConfigClient.Context(
      cdnUrl: "https://cdn.test",
      appId: RemoteConfigClientTests.appId,
      channel: "production",
      trustedKeys: [],
      allowInsecureUrls: false
    )
    let replayed = await configClient.refresh(unsigned).result
    XCTAssertEqual(replayed.snapshot.file?.version, 12)
    XCTAssertFalse(replayed.changed)
  }

  func testKeepsTheVerifiedCopyWhenTheFileGoesMissingOrTheNetworkFails() async throws {
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    let configClient = client()
    _ = await configClient.refresh(context(nil)).result

    ConfigStubProtocol.reply(basePath, 404)
    let missing = await configClient.refresh(context(nil)).result
    XCTAssertEqual(missing.snapshot.file?.version, 3)
    XCTAssertNil(missing.error)

    ConfigStubProtocol.reply(basePath, 503)
    let failed = await configClient.refresh(context(nil)).result
    XCTAssertEqual(failed.snapshot.file?.version, 3)
    XCTAssertEqual(failed.error, "http_503")

    ConfigStubProtocol.reply(basePath, 200, "{ not json")
    let broken = await configClient.refresh(context(nil)).result
    XCTAssertEqual(broken.snapshot.file?.version, 3)
    XCTAssertEqual(broken.error, "invalid_config")
  }

  func testStartsOverForAnotherApp() async throws {
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    let configClient = client()
    _ = await configClient.refresh(context(nil)).result
    // Another app ID on the same install: nothing carries over, not even the
    // highest version seen, so its version 1 is accepted.
    let other = RemoteConfigClient.Context(
      cdnUrl: "https://cdn.test",
      appId: "11111111-2222-4333-8444-555555555555",
      channel: nil,
      trustedKeys: [],
      allowInsecureUrls: false
    )
    let otherPath = "/config/11111111-2222-4333-8444-555555555555/__base__/config.json"
    let otherFile = RemoteConfigTests.base
      .replacingOccurrences(of: RemoteConfigClientTests.appId, with: other.appId)
      .replacingOccurrences(of: "\"version\": 3", with: "\"version\": 1")
    ConfigStubProtocol.reply(otherPath, 200, otherFile)
    let switched = await configClient.refresh(other).result
    XCTAssertEqual(switched.snapshot.file?.version, 1)
    XCTAssertEqual(switched.snapshot.file?.appId, other.appId)
    let oldApp = await configClient.snapshot(appId: RemoteConfigClientTests.appId, channel: nil)
    XCTAssertNil(oldApp.file)
  }

  func testSharesAFetchOnlyForTheSameChannel() async throws {
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    ConfigStubProtocol.reply(productionPath, 200, RemoteConfigTests.production)
    let configClient = client()
    async let first = configClient.refresh(context(nil))
    async let same = configClient.refresh(context(nil))
    let results = await [first, same]
    XCTAssertEqual(results.filter { $0.ownFetch }.count, 1, "one fetch, one report")
    async let base = configClient.refresh(context(nil))
    async let production = configClient.refresh(context("production"))
    let (baseResult, productionResult) = await (base, production)
    XCTAssertTrue(productionResult.ownFetch, "another channel fetches on its own")
    XCTAssertEqual(productionResult.result.snapshot.file?.channel, "production")
    XCTAssertEqual(baseResult.result.snapshot.file?.version, 3)
  }

  func testUsesTheBaseCopyWhenAChannelIsDeletedAndTheBaseFetchFails() async throws {
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    let configClient = client()
    _ = await configClient.refresh(context(nil)).result
    ConfigStubProtocol.reply(betaPath, 200, RemoteConfigTests.betaDeleted)
    ConfigStubProtocol.reply(basePath, 503)
    let result = await configClient.refresh(context("beta")).result
    XCTAssertEqual(result.error, "http_503")
    XCTAssertEqual(result.snapshot.file?.version, 3)
    XCTAssertNil(result.snapshot.file?.channel)
  }

  func testANewChannelShowsTheBaseConfigUntilItsFirstFetch() async throws {
    ConfigStubProtocol.reply(basePath, 200, RemoteConfigTests.base)
    let configClient = client()
    _ = await configClient.refresh(context(nil)).result
    let beforeFetch = await configClient.snapshot(appId: RemoteConfigClientTests.appId, channel: "production")
    XCTAssertEqual(beforeFetch.file?.version, 3)
    let skipsRecentFetch = await configClient.shouldSkip(intervalMs: 600_000)
    let skipsWithoutInterval = await configClient.shouldSkip(intervalMs: 0)
    XCTAssertTrue(skipsRecentFetch)
    XCTAssertFalse(skipsWithoutInterval)
  }
}
