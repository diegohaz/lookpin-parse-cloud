/**
 * Validate feeling
 */
exports.validateFeeling = function(feeling) {
  var feelings  = ['red', 'blue', 'black'];

  if (~feelings.indexOf(feeling)) {
    return true;
  } else {
    return false;
  }
}