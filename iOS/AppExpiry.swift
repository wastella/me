import Foundation
import UserNotifications

/// Free developer accounts sign apps for 7 days. This reads the real expiry date from the
/// installed provisioning profile so the app can warn you before it stops opening.
enum AppExpiry {
    static let date: Date? = {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex)
        else { return nil }
        let plist = data[start.lowerBound..<end.upperBound]
        let dict = try? PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any]
        return dict?["ExpirationDate"] as? Date
    }()

    static var daysLeft: Int? {
        date.map { Int(floor($0.timeIntervalSinceNow / 86_400)) }
    }

    /// Show a warning in the app in the last 2 days.
    static var isSoon: Bool { (date?.timeIntervalSinceNow ?? .infinity) < 2 * 86_400 }

    /// Local reminders 1 day and 3 hours before it expires (re-scheduled on every launch).
    static func scheduleReminders() {
        guard let date else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let ids = ["expiry-1d", "expiry-3h"]
            center.removePendingNotificationRequests(withIdentifiers: ids)
            let plan: [(String, TimeInterval, String)] = [
                (ids[0], 86_400, "Narrate needs a refresh tomorrow"),
                (ids[1], 3 * 3_600, "Narrate stops opening in 3 hours"),
            ]
            for (id, before, title) in plan {
                let fire = date.addingTimeInterval(-before)
                guard fire > Date() else { continue }
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = "Open your Mac on the same Wi‑Fi (it reinstalls Narrate automatically), or run install-iphone.sh."
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
                center.add(UNNotificationRequest(identifier: id, content: content,
                                                 trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
        }
    }
}
