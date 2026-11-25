import js from "@eslint/js";

export default [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: "latest",
			globals: {
				URL: "readonly",
				TextEncoder: "readonly",
				Response: "readonly",
				Request: "readonly",
				Headers: "readonly",
				fetch: "readonly",
				console: "readonly",
				crypto: "readonly",
				Buffer: "readonly",
			},
		},
		rules: {
			"arrow-spacing": ["warn", { before: true, after: true }],
			"brace-style": ["error", "stroustrup", { allowSingleLine: true }],
			"comma-dangle": ["error", "always-multiline"],
			"comma-spacing": "error",
			"comma-style": "error",
			curly: ["error", "multi-line", "consistent"],
			"dot-location": ["error", "property"],
			indent: ["error", "tab"],
			"keyword-spacing": "error",
			"no-console": "off",
			"no-multiple-empty-lines": ["error", { max: 2, maxEOF: 1, maxBOF: 0 }],
			"no-trailing-spaces": ["error"],
			"no-var": "error",
			"object-curly-spacing": ["error", "always"],
			"prefer-const": "error",
			quotes: ["error", "double"],
			semi: ["error", "always"],
			"space-before-blocks": "error",
			"space-before-function-paren": [
				"error",
				{
					anonymous: "never",
					named: "never",
					asyncArrow: "always",
				},
			],
			"space-in-parens": "error",
			"space-infix-ops": "error",
			"space-unary-ops": "error",
			"spaced-comment": "error",
		},
	},
];
