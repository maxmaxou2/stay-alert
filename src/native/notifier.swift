import AppKit
import Foundation
import UserNotifications

let WATCHDOG_SECONDS: TimeInterval = 4 * 3600

var title = ""
var subtitle: String?
var body = ""
var iconPath: String?
var soundName: String?
var sticky = false
var transientSeconds: Double = 5
var hostBundle: String?

var i = 1
let args = CommandLine.arguments
while i < args.count {
	let a = args[i]
	let next = { (offset: Int) -> String? in
		i + offset < args.count ? args[i + offset] : nil
	}
	switch a {
	case "--title":
		title = next(1) ?? ""
		i += 2
	case "--subtitle":
		subtitle = next(1)
		i += 2
	case "--message":
		body = next(1) ?? ""
		i += 2
	case "--icon":
		iconPath = next(1)
		i += 2
	case "--sound":
		soundName = next(1)
		i += 2
	case "--host":
		hostBundle = next(1)
		i += 2
	case "--sticky":
		sticky = true
		i += 1
	case "--transient-seconds":
		if let v = next(1), let d = Double(v) {
			transientSeconds = d
		}
		i += 2
	default:
		i += 1
	}
}

final class Delegate: NSObject, UNUserNotificationCenterDelegate {
	let hostBundle: String?

	init(hostBundle: String?) {
		self.hostBundle = hostBundle
	}

	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		willPresent notification: UNNotification
	) async -> UNNotificationPresentationOptions {
		[.banner, .sound, .list]
	}

	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		didReceive response: UNNotificationResponse
	) async {
		if let bundle = hostBundle,
			let url = NSWorkspace.shared.urlForApplication(
				withBundleIdentifier: bundle
			)
		{
			let config = NSWorkspace.OpenConfiguration()
			config.activates = true
			_ = try? await NSWorkspace.shared.openApplication(
				at: url, configuration: config
			)
		}
		exit(0)
	}
}

let center = UNUserNotificationCenter.current()
let delegate = Delegate(hostBundle: hostBundle)
center.delegate = delegate

let identifier = UUID().uuidString

@MainActor
func postNotification() async {
	do {
		let granted = try await center.requestAuthorization(options: [
			.alert, .sound,
		])
		if !granted {
			FileHandle.standardError.write(Data(
				"stay-alert-notifier: authorization denied\n".utf8
			))
			exit(2)
		}
	} catch {
		FileHandle.standardError.write(Data(
			"stay-alert-notifier: \(error)\n".utf8
		))
		exit(2)
	}

	let content = UNMutableNotificationContent()
	content.title = title
	if let subtitle = subtitle, !subtitle.isEmpty {
		content.subtitle = subtitle
	}
	content.body = body
	if let name = soundName {
		content.sound =
			name == "default"
			? .default
			: UNNotificationSound(named: UNNotificationSoundName(name))
	}
	if let iconPath = iconPath, !iconPath.isEmpty {
		let original = URL(fileURLWithPath: iconPath)
		let staged = stageIcon(at: original, identifier: identifier)
		if let staged = staged,
			let attachment = try? UNNotificationAttachment(
				identifier: "icon", url: staged, options: nil
			)
		{
			content.attachments = [attachment]
		}
	}
	if let host = hostBundle {
		content.userInfo = ["hostBundle": host]
	}

	let request = UNNotificationRequest(
		identifier: identifier, content: content, trigger: nil
	)

	do {
		try await center.add(request)
	} catch {
		FileHandle.standardError.write(Data(
			"stay-alert-notifier: post failed: \(error)\n".utf8
		))
		exit(3)
	}

	if !sticky {
		DispatchQueue.main.asyncAfter(deadline: .now() + transientSeconds) {
			center.removeDeliveredNotifications(withIdentifiers: [identifier])
			exit(0)
		}
	}

	DispatchQueue.main.asyncAfter(deadline: .now() + WATCHDOG_SECONDS) {
		exit(0)
	}
}

func stageIcon(at source: URL, identifier: String) -> URL? {
	let tmp = FileManager.default.temporaryDirectory
		.appendingPathComponent(
			"stay-alert-icon-\(identifier)"
		)
		.appendingPathExtension(source.pathExtension)
	do {
		try? FileManager.default.removeItem(at: tmp)
		try FileManager.default.copyItem(at: source, to: tmp)
		return tmp
	} catch {
		return nil
	}
}

Task { @MainActor in
	await postNotification()
}

RunLoop.main.run()
