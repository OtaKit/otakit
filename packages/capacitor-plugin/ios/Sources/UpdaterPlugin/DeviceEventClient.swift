import Foundation

enum DeviceEventAction: String {
    case downloaded
    case applied
    case downloadError = "download_error"
    case checkError = "check_error"
    case rollback
}

enum DeviceEventClient {
    private static let delivery = EventDelivery()
    static func resume() { delivery.resume() }
    static func send(
        ingestUrl: String,
        appId: String,
        platform: String,
        action: DeviceEventAction,
        bundleVersion: String,
        channel: String?,
        runtimeVersion: String?,
        releaseId: String,
        nativeBuild: String,
        detail: String?,
        attemptId: String? = nil,
        phase: String? = nil,
        lifecycle: String = "unknown"
    ) {
        let sanitizedBase = ingestUrl.replacingOccurrences(
            of: "/+$",
            with: "",
            options: .regularExpression
        )

        guard let url = URL(string: "\(sanitizedBase)/events") else {
            return
        }

        var payload: [String: Any] = [
            "eventId": UUID().uuidString.lowercased(),
            "sentAt": ISO8601DateFormatter().string(from: Date()),
            "platform": platform,
            "action": action.rawValue,
            "bundleVersion": bundleVersion,
            "releaseId": releaseId,
            "nativeBuild": nativeBuild,
            "nativeSdkVersion": SDKVersion.value,
            "lifecycle": lifecycle,
        ]
        if let attemptId { payload["attemptId"] = attemptId }
        if let phase { payload["phase"] = phase }
        if let channel, !channel.isEmpty {
            payload["channel"] = channel
        }
        if let runtimeVersion, !runtimeVersion.isEmpty {
            payload["runtimeVersion"] = runtimeVersion
        }
        if let detail {
            payload["detail"] = String(detail.prefix(500))
        }

        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            return
        }

        delivery.enqueue(url: url, appId: appId, body: body)
    }
}
