var names = require('cloud/names.js');

// Validate nickname
exports.nickname = function(nickname) {
  if (nickname.indexOf(' ') > 0 && nickname.length <= 48) {
    return true;
  } else {
    return false;
  }
}

// Validate feeling
exports.feeling = function(feeling) {
  var feelings = Object.keys(names.adjectives);

  if (~feelings.indexOf(feeling)) {
    return true;
  } else {
    return false;
  }
}