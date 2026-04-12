import Foundation

enum DeviceEventAction: String {
    case downloaded
    case applied
    case downloadError = "download_error"
    case rollback
}

enum DeviceEventClient {
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
        detail: String?
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
        ]
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

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(appId, forHTTPHeaderField: "X-App-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        request.timeoutInterval = 10

        // Device events are best-effort and should never block the update flow.
        URLSession.shared.dataTask(with: request).resume()
    }
}
