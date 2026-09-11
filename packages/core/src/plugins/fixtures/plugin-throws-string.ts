// @code-analyzer/core — plugin fixture that throws a non-Error
//
// A module body that throws a string reaches the loader's catch as a string, not
// an Error. The classification has to reject it — otherwise a plugin that merely
// failed to initialise would be reported as "not installed".
throw 'fixture: a plugin that throws a string';
