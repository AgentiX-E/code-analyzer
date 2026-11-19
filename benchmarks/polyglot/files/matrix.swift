import Foundation

let LIMIT = 10

protocol Drawable {
    func draw()
}

enum Color {
    case RED
    case GREEN
}

struct Point {
    var x: Int
}

/// A widget.
public class Widget: Drawable {
    var label: String

    init(label: String) {
        self.label = label
    }

    func draw() {
        let local = helper(label)
    }
}

public func topLevel(name: String) -> String {
    return helper(name)
}

public func identity<T>(value: T) -> T {
    return value
}

public func later() async -> Int {
    return 1
}
