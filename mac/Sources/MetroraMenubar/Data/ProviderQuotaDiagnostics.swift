import Foundation

/// Sanitizes provider diagnostics before they reach SwiftUI or unified logging.
/// Quota payloads never carry these fields; this helper also protects legacy
/// error paths that still contain an upstream response excerpt.
enum ProviderQuotaDiagnostics {
    static func sanitize(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        var cleaned = value.replacingOccurrences(of: "\u{0000}", with: "")
        let patterns: [(String, String)] = [
            (#"(?i)Bearer\s+\S+"#, "Bearer [REDACTED]"),
            (#"sk-ant-[A-Za-z0-9_-]+"#, "[REDACTED_TOKEN]"),
            (#"sk-[A-Za-z0-9_-]{16,}"#, "[REDACTED_TOKEN]"),
            (#"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#, "[REDACTED_TOKEN]"),
            (#"(?i)"?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|account[_-]?id|authorization|chatgpt-account-id)"?\s*[:=]\s*"?[^",}\s]+"?"#, "[REDACTED_CREDENTIAL_FIELD]"),
            (#"(?i)(?:token|api[_-]?key|apikey)=[^&\s]+"#, "[REDACTED_QUERY]"),
            (#"(?i)(?:/Users/|[A-Za-z]:\\Users\\)[^ \t\r\n]+"#, "[REDACTED_PATH]"),
        ]
        for (pattern, replacement) in patterns {
            cleaned = cleaned.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        if cleaned.count > 240 {
            cleaned = String(cleaned.prefix(240)) + "…"
        }
        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
