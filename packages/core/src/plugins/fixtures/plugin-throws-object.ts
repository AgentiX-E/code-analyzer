// @code-analyzer/core — plugin fixture that throws a message-less object
//
// The thrown value is an object with an unrelated `code` and no `message`, so the
// classification cannot match on either signal and has to fall through to
// rethrowing what the module actually threw.
throw { code: 'SOMETHING_ELSE' };
