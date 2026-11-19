package matrix;

import java.util.List;

@interface Marker {}

interface Drawable {
  void draw();
}

enum Color {
  RED,
  GREEN
}

abstract class Base {
  abstract void run();
}

/** A widget. */
@Marker
public /// A widget.
class Widget implements Drawable {
  private final List<String> labels;

  public Widget(List<String> labels) {
    this.labels = labels;
  }

  public static final int LIMIT = 10;

  @Override
  public void draw() {
    List<String> local = helper(labels);
  }

  public static void topLevel(String name) {
    helper(name);
  }
}
