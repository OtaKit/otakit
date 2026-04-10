import Foundation

enum StatsAction: String {
    case downloaded
    case applied
    case downloadError = "download_error"
    case rollback
}

enum StatsClient {
    static func send(
        updateUrl: String,
        appId: String,
        platform: String,
        action: StatsAction,
        bundleVersion: String?,
        channel: String?,
        releaseId: String?,
        nativeBuild: String?,
        errorMessage: String?
    ) {
        let sanitizedBase = updateUrl.replacingOccurrences(
            of: "/+$",
            with: "",
            options: .regularExpression
        )

        guard let url = URL(string: "\(sanitizedBase)/stats") else {
            return
        }

        var payload: [String: Any] = [
            "platform": platform,
            "action": action.rawValue,
        ]
        if let bundleVersion {
            payload["bundleVersion"] = bundleVersion
        }
        if let channel, !channel.isEmpty {
            payload["channel"] = channel
        }
        if let releaseId, !releaseId.isEmpty {
            payload["releaseId"] = releaseId
        }
        if let nativeBuild {
            payload["nativeBuild"] = nativeBuild
        }
        if let errorMessage {
            payload["errorMessage"] = String(errorMessage.prefix(500))
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

        // Fire and forget - don't block on response
        URLSession.shared.dataTask(with: request).resume()
    }
}
