export default defineNuxtConfig({
  srcDir: 'app/',
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
  },
  app: {
    head: {
      title: 'Game Release Explorer',
      meta: [
        { name: 'description', content: 'Explore video game release frequency by year, genre, and country.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
