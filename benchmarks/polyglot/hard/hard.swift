import Foundation

/** The constructs a Swift review meets: attributes, access levels, aliases and an extension that names a type. */

public typealias Completion = (Result<Void, Error>) -> Void

public protocol Service {
  associatedtype Payload

  func load(_ id: String) async throws -> Payload
}

public struct Config {
  public static let shared = Config()

  public var timeout: TimeInterval = 30
}

public enum State: String {
  case idle
  case running
  case failed
}

extension Config {
  public var milliseconds: Int {
    Int(timeout * 1000)
  }
}

@MainActor
public final class Store {
  private var state: State = .idle

  public func reset() {
    state = .idle
  }
}

public actor Cache {
  private var entries: [String: Data] = [:]
}

open class Base {
  open func describe() -> String {
    "base"
  }
}

internal struct Hidden {
  let value: Int
}

func topLevel(_ value: Int) -> Int {
  value
}

public let globalLimit = 10

public enum Outcome {
  case success
  case failure(reason: String)
}
