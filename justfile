set shell := ["bash", "-uc"]

default: test

test:
  npm test

check:
  npm run check

package:
  npm run build
