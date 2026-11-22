const ts = require('typescript-eslint')
module.exports = [{ ignores: ['dist/**'] }, ...ts.configs.recommended]
