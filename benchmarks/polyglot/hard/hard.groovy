package com.example.constructs

/**
 * The constructs a Groovy review meets: annotation types, traits, static nested classes and untyped methods.
 */

@interface Marker {
  String value() default ""
}

trait Greeter {
  String greet(String name) {
    "hello ${name}"
  }
}

enum Level {
  LOW,
  HIGH
}

abstract class Base {
  abstract String describe()
}

@CompileStatic
class Service extends Base implements Greeter {
  static class Nested {
    int value
  }

  String describe() {
    "service"
  }
}

def topLevel() {
  1
}

String typed(String input) {
  input
}

class Config {
  String name
  int port = 8080

  String url() {
    "http://localhost:${port}"
  }
}
