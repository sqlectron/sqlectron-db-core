// It has ts files setup not applied for the whole project just for any js configuration files at the root
// such as this file for instance.
module.exports = {
  extends: ['eslint:recommended', 'prettier'],
  plugins: ['prettier'],
  env: {
    node: true,
    mocha: true,
  },
  overrides: [
    {
      // No extension defined because all files in src and spec must be .ts
      files: ['src/**/*', 'spec/**/*'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: './tsconfig.eslint.json',
      },
      plugins: ['prettier', '@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'plugin:@typescript-eslint/recommended',
        'plugin:prettier/recommended',
      ],
    },
  ],
};
