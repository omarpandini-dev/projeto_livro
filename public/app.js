const booksGrid = document.querySelector("#booksGrid");
const heroImage = document.querySelector("#heroImage");
const readerTitle = document.querySelector("#reader-title");
const bookStage = document.querySelector("#bookStage");
const prevButton = document.querySelector("#prevPage");
const nextButton = document.querySelector("#nextPage");
const toggleAudioButton = document.querySelector("#toggleAudio");
const closeButton = document.querySelector("#closeReader");

let books = [];
let pageFlip = null;
let currentBook = null;
let currentAudio = null;
let isAudioMuted = false;

function pageFlipLibrary() {
  return window.St?.PageFlip;
}

function destroyReader() {
  if (pageFlip) {
    pageFlip.destroy();
    pageFlip = null;
  }
  stopPageAudio();
  bookStage.innerHTML = "";
}

function stopPageAudio() {
  if (!currentAudio) return;

  currentAudio.pause();
  currentAudio.currentTime = 0;
  currentAudio = null;
}

function updateAudioButton() {
  const icon = toggleAudioButton.querySelector("span");
  const label = isAudioMuted ? "Ativar audio" : "Desativar audio";

  toggleAudioButton.title = label;
  toggleAudioButton.setAttribute("aria-label", label);
  toggleAudioButton.setAttribute("aria-pressed", String(isAudioMuted));
  icon.textContent = isAudioMuted ? "🔇" : "🔊";
}

function playPageAudio(pageIndex) {
  const page = currentBook?.pages?.[pageIndex];
  stopPageAudio();

  if (isAudioMuted || !page?.audioUrl) return;

  currentAudio = new Audio(page.audioUrl);
  currentAudio.play().catch(() => {
    currentAudio = null;
  });
}

function renderBooks() {
  if (books.length === 0) {
    booksGrid.innerHTML = '<p class="status-message">Nenhum livro encontrado em assets/livros.</p>';
    return;
  }

  booksGrid.innerHTML = books
    .map(
      (book) => `
        <button class="book-card" type="button" data-book="${book.slug}">
          <span class="book-cover">
            <img src="${escapeHtml(book.thumb)}" alt="Capa de ${escapeHtml(book.title)}" loading="lazy">
          </span>
          <span class="book-meta">
            <span class="book-title">${escapeHtml(book.title)}</span>
            ${
              book.description
                ? `<span class="book-description">${escapeHtml(book.description)}</span>`
                : ""
            }
            <span class="book-pages">${book.pageCount} paginas</span>
          </span>
        </button>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getReaderSize() {
  const stageRect = bookStage.getBoundingClientRect();
  const viewportWidth = Math.max(300, Math.floor(stageRect.width || window.innerWidth - 32));
  const viewportHeight = Math.max(420, Math.floor(stageRect.height || window.innerHeight - 130));
  const isCompact = window.innerWidth < 760;

  return {
    pageWidth: Math.max(300, Math.floor(viewportWidth / (isCompact ? 1 : 2))),
    pageHeight: viewportHeight
  };
}

function buildPageNodes(book) {
  return book.pages
    .map(
      (page) => `
        <div class="page">
          <img src="${page.url}" alt="${book.title}, pagina ${page.number}" draggable="false">
        </div>
      `
    )
    .join("");
}

function openBook(book) {
  const PageFlip = pageFlipLibrary();
  destroyReader();
  currentBook = book;
  readerTitle.textContent = book.title;
  document.body.classList.add("reader-active");

  if (!PageFlip) {
    bookStage.innerHTML = '<p class="status-message">Nao foi possivel carregar o StPageFlip. Verifique sua conexao.</p>';
    return;
  }

  const bookElement = document.createElement("div");
  bookElement.className = "flip-book";
  bookElement.innerHTML = buildPageNodes(book);
  bookStage.append(bookElement);

  const { pageWidth, pageHeight } = getReaderSize();
  pageFlip = new PageFlip(bookElement, {
    width: pageWidth,
    height: pageHeight,
    size: "stretch",
    minWidth: 300,
    maxWidth: pageWidth,
    minHeight: 420,
    maxHeight: pageHeight,
    showCover: true,
    usePortrait: true,
    mobileScrollSupport: false,
    flippingTime: 760,
    maxShadowOpacity: 0.22
  });

  pageFlip.loadFromHTML(bookElement.querySelectorAll(".page"));
  pageFlip.on("flip", (event) => {
    playPageAudio(event.data);
  });
  playPageAudio(pageFlip.getCurrentPageIndex());
  document.querySelector("#leitor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeReader() {
  destroyReader();
  currentBook = null;
  readerTitle.textContent = "Escolha um livro";
  bookStage.innerHTML = '<p class="empty-reader">Selecione um livro para comecar.</p>';
  document.body.classList.remove("reader-active");
}

booksGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".book-card");
  if (!card) return;

  const book = books.find((item) => item.slug === card.dataset.book);
  if (book) openBook(book);
});

prevButton.addEventListener("click", () => {
  pageFlip?.flipPrev();
});

nextButton.addEventListener("click", () => {
  pageFlip?.flipNext();
});

toggleAudioButton.addEventListener("click", () => {
  isAudioMuted = !isAudioMuted;
  updateAudioButton();

  if (isAudioMuted) {
    stopPageAudio();
    return;
  }

  if (pageFlip) {
    playPageAudio(pageFlip.getCurrentPageIndex());
  }
});

closeButton.addEventListener("click", closeReader);

window.addEventListener("resize", () => {
  if (!currentBook) return;
  openBook(currentBook);
});

async function loadBooks() {
  try {
    const response = await fetch("/api/books");
    if (!response.ok) throw new Error("Falha ao carregar livros.");

    books = await response.json();
    if (books[0]?.thumb) {
      heroImage.src = books[0].thumb;
    }
    renderBooks();
  } catch {
    booksGrid.innerHTML = '<p class="status-message">Nao foi possivel carregar a biblioteca.</p>';
  }
}

loadBooks();
updateAudioButton();
