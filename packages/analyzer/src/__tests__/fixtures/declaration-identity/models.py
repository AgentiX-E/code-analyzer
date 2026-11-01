# The two declarations a name can have at once, and the nesting a line range can see.
#
# `Response.status` is a property getter and a property setter. Both are `Method` declarations, both are named
# `status`, and both are held by `Response` - so a graph that keys nodes by qualified name keeps one of them and
# silently drops the other. The setter is the one that gets dropped in practice, and every call through it then
# reads as a call to the getter, which is how a method with callers was reported as dead code.


class Response:
    def __init__(self, status: int = 200) -> None:
        self._status = status

    @property
    def status(self) -> int:
        return self._status

    @status.setter
    def status(self, value: int) -> None:
        self._status = value

    def clean(self) -> str:
        # A read through the getter, from the declaration that holds it.
        return str(self.status)


def outer() -> int:
    # A declaration inside a function body is a closure of that function, not a module-level name.
    def inner() -> int:
        return 1

    return inner()


def first_caller() -> int:
    def helper() -> int:
        return 2

    return helper()


def second_caller() -> int:
    def helper() -> int:
        return 3

    return helper()
