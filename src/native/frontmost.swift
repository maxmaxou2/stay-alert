import AppKit

let name = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
print(name)
