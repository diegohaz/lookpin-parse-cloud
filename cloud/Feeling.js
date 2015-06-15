module.exports = Feeling;

function Feeling(name) {
  this.name = name;
}

Feeling.feelings = ['red', 'blue', 'black'];

Feeling.validate = function(feeling) {
  if (~Feeling.feelings.indexOf(feeling)) {
    return true;
  } else {
    return false;
  }
};