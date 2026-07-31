module.exports = {
  content: ["./src/manager/public/index.html", "./src/manager/public/app.js"],
  theme: {
    extend: {
      colors: {
        mint: {
          50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80",
          500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d"
        },
        surface: "#f8fafc"
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      boxShadow: {
        soft: "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
        hover: "0 10px 25px -5px rgba(0, 0, 0, 0.1)"
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};
