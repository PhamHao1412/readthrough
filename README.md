# ReadThrough 📖
> **Smart Translation Reader** — A premium reading assistant designed to help developers, students, and language learners read technical books, documents, and research papers efficiently. Highlight words to translate instantly, save vocabulary to your notebook, and get AI-powered context-aware explanations.

### 🌐 Demo: [You can try it out here: https://readthrough.vercel.app/](https://readthrough.vercel.app/)

---

## 🚀 Key Features

* 📂 **Multi-Format Support:** Read **PDF, EPUB, Markdown, and TXT** documents seamlessly in a unified viewer.
* 🌓 **Dynamic Reading Themes:** Toggle between **Light**, **Dark**, and **Sepia** themes with customizable font settings to match your environment.
* ⚡ **Highlight-to-Translate:** Select any word or phrase to view its dictionary definition and Vietnamese translation instantly in the sidebar.
* 🤖 **AI-Powered Explanations:** Query OpenAI models to explain complex jargon, code boilerplate, or academic terms directly in the context of the page you are reading.
* 📔 **Vocabulary Notebook:** Keep track of saved terms with phonetic spellings, audio pronunciations, and saved context from the book.
* 🃏 **Interactive Flashcards:** Review and memorize saved vocabulary through a built-in interactive flashcard system with shuffling.

---

## 🎨 Walkthrough & Interface Tour

### 🏠 1. My Library (Home Screen)
The home dashboard provides an intuitive catalog of all your uploaded reading materials. Track your reading progress across multiple books, search for specific titles, and upload new documents in various formats.

![Library Home Screen](docs/imgs/home.png)

---

### 📖 2. Interactive Document Reader
The reader workspace features dual-pane integration: the book content on the left (supporting zoom, scrolling, page jumps, and active heading highlights) and the interactive dictionary/AI helper on the right.

![Interactive Document Reader](docs/imgs/reading_book.png)

---

### 🤖 3. AI Contextual Explanations
When translating standard dictionary terms isn't enough, toggle the **AI Explain** tab. Our built-in OpenAI integration analyzes the context of the book and provides a natural Vietnamese breakdown of programming terminology, jargon, or complex syntax.

![AI Contextual Explanation](docs/imgs/ai_explain.png)

---

### 🌗 4. Dark, Light, and Sepia Themes
Optimize your reading experience for day or night. ReadThrough includes three designed layouts: **Light** for daytime, **Dark** for high contrast in low light, and **Sepia** for eye comfort.

| Light Mode | Dark Mode | Sepia Mode |
| :---: | :---: | :---: |
| ![Light Theme](docs/imgs/light_theme.png) | ![Dark Theme](docs/imgs/dark_theme.png) | ![Sepia Theme](docs/imgs/sepia.png) |

---

### 📔 5. Vocabulary Notebook
Review and edit all the words you have saved from different books. Play high-quality audio pronunciations, copy translations, and expand the context block to see the exact sentence where the word was highlighted.

![Vocabulary Notebook](docs/imgs/vocab_note.png)

---

### 🃏 6. Flashcard Practice Sessions
Study saved words using interactive flashcards. Click on any card to flip and reveal the translation, shuffle the deck, and track your progress in real-time.

![Flashcards](docs/imgs/flash_card.png)

---

## 🛠️ Technology Stack

ReadThrough is built using a modern decoupled architecture:

### Frontend (`readthrough-fe`)
* **Framework:** React 18 with TypeScript
* **Build System:** Vite
* **Styling:** Tailwind CSS & Custom CSS Themes
* **Libraries:** EpubJS (EPUB rendering), PDFJS-Dist (PDF rendering), Lucide React (Icons)

### Backend (`readthrough-be`)
* **Core Language:** Go 1.25
* **Web Framework:** Gin Gonic
* **Database & ORM:** PostgreSQL & GORM
* **Storage:** Cloudflare R2 Storage (S3 API compatible) / Local fallback
* **AI Provider:** OpenAI GPT-4o-mini
* **Migration Tool:** Goose

---

## ⚙️ Getting Started Locally

### 1. Prerequisites
* [Go](https://go.dev/doc/install) (version 1.22+)
* [Node.js](https://nodejs.org/en/download) (version 18+)
* [PostgreSQL](https://www.postgresql.org/download/)

### 2. Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd readthrough-be
   ```
2. Copy the example environment file and configure your credentials:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` and fill in your `DB_URL`, `OPENAI_API_KEY`, and Cloudflare R2 storage credentials.*
3. Run database migrations:
   - Using the Makefile:
     ```bash
     make migrate-up
     ```
   - Or running `goose` directly:
     ```bash
     goose -dir data/migrations postgres "postgres://postgres:hacker1412@localhost:5438/playground?sslmode=disable&search_path=readful" up
     ```
4. Start the Go API server:
   ```bash
   go run main.go
   ```
   *The server will run on `http://localhost:8080`.*

### 3. Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd ../readthrough-fe
   ```
2. Copy the local environment configurations:
   ```bash
   cp .env.example .env.local
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the frontend development server:
   ```bash
   npm run dev
   ```
   *Open `http://localhost:5173` in your browser.*

---

## 🐳 Docker Deployment
To run the full stack locally with Docker:
1. From the project root, start the application:
   ```bash
   docker compose up --build
   ```
