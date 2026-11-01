import typing as t


@t.overload
def locate(import_name: str) -> str: ...


@t.overload
def locate(import_name: str, raise_if_not_found: bool) -> str: ...


def locate(import_name: str, raise_if_not_found: bool = True) -> str:
    return import_name


def load() -> str:
    return locate("app")
