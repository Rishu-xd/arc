This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local model setup

Arc uses [Ollama](https://ollama.com) to generate chat responses on your computer. Install and start Ollama, then download a model such as `llama3.2` with `ollama pull llama3.2`. Start the app with `npm run dev` and open [http://localhost:3000](http://localhost:3000).

By default, Arc connects to `http://127.0.0.1:11434` and uses `llama3.2:latest`. To choose a different Ollama server or installed model, set `OLLAMA_BASE_URL` and/or `OLLAMA_MODEL` in `.env.local`, then restart Next.js:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=dolphin-phi:latest
```

Chat generation runs locally. Conversation history is kept while the page is open and sent with follow-up prompts. When you ask for pictures, Arc searches Wikimedia Commons and displays matching, attributed image nodes; requests default to three results and can ask for up to ten. Image search needs an internet connection. Use the response node's **Chat history** button to review the conversation and **More** to expand a response.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
