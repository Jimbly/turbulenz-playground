const fs = require('fs');
module.exports = {
  test: {
    fp: fs.readFileSync(`${__dirname}/shaders/test.fp`, 'utf8'),
  },
};
