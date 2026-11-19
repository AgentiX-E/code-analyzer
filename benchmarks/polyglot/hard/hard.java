package com.example.constructs;

import java.util.List;

/**
 * **The constructs a Java review meets and a keyword table can miss.**
 *
 * Every declaration here is one a reviewer files a comment against, and each is written the way the language allows
 * rather than the way a scanner likes: a file's top level may hold several types, and only one of them may be public -
 * which is why nothing here is.
 */

sealed interface Shape permits Circle, Square {
  double area();
}

record Circle(double radius) implements Shape {
  Circle {
    if (radius < 0) throw new IllegalArgumentException("radius");
  }

  public double area() {
    return Math.PI * radius * radius;
  }
}

final class Square implements Shape {
  private final double side;

  Square(double side) {
    this.side = side;
  }

  public double area() {
    return side * side;
  }
}

enum Op {
  PLUS {
    int apply(int a, int b) {
      return a + b;
    }
  },
  MINUS {
    int apply(int a, int b) {
      return a - b;
    }
  };

  abstract int apply(int a, int b);
}

@interface Marker {
  String value() default "";
}

@Marker("bundle")
class Bundle {
  static final String NAME = "bundle";

  static {
    System.out.println(NAME);
  }

  static class Inner {
    int x;
  }

  List<String> names() {
    return List.of();
  }
}
