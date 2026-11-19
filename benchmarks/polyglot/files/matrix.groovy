import java.util.List

interface Drawable {
  void draw()
}

enum Color {
  RED,
  GREEN
}

abstract class Base {
  abstract void run()
}

/** A widget. */
class Widget extends Base implements Drawable {
  public static final int LIMIT = 10
  private final List<String> labels

  Widget(List<String> labels) {
    this.labels = labels
  }

  @Override
  void draw() {
    List<String> local = helper(labels)
  }

  static void topLevel(String name) {
    helper(name)
  }
}
