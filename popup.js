document.getElementById('startButton').addEventListener('click', async () => {
    const button = document.getElementById('startButton');
    const logDiv = document.getElementById('log');
    button.disabled = true;
  
    // Function to add log entry to popup
    function addLogEntry(message, type = 'info') {
      const entry = document.createElement('div');
      entry.className = `log-entry ${type}`;
      entry.textContent = message;
      logDiv.appendChild(entry);
      logDiv.scrollTop = logDiv.scrollHeight;
    }
  
    // Listen for messages from the content script
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'LOG') {
        addLogEntry(message.message, message.logType);
      }
    });
  
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
      // Inject the content script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scrapeMovies,
      });
    } catch (error) {
      addLogEntry(`Error: ${error.message}`, 'warning');
      button.disabled = false;
    }
  });
  


  // Function that will be injected into the page
  function scrapeMovies() {
    async function fetchAllMovies() {
      const movies = new Set();
      let lastMovieCount = 0;
      let noNewMoviesCount = 0;
      const maxNoNewMovies = 3;
      let scrollDirection = 'down';
      let userScrollReminder = false; // Track if reminder was sent
  
      async function performScroll() {
        const height = document.body.scrollHeight;
        if (scrollDirection === 'down') {
          window.scrollTo(0, height);
          scrollDirection = 'up';
        } else {
          window.scrollTo(0, height * 0.3);
          scrollDirection = 'down';
        }
      }
  
      async function scanForMovies() {
        const movieElements = document.querySelectorAll('a[aria-label], div[aria-label]');
        let newMoviesFound = false;
  
        movieElements.forEach((element) => {
          const label = element.getAttribute('aria-label');
          if (label) {
            const match = label.match(/^(.*?)(?:,\s*|\s+\(?)(\d{4})(?:\)|$)/);
            if (match) {
              const title = match[1].trim();
              const year = match[2];
              const movieKey = `${title},${year}`;
              if (!movies.has(movieKey)) {
                movies.add(movieKey);
                newMoviesFound = true;
              }
            }
          }
        });
  
        return newMoviesFound;
      }

      chrome.runtime.sendMessage({
        type: 'LOG',
        message: `Collecting films, please scroll down to load more.`,
        logType: 'info',
      });

      while (true) {
        await performScroll();
  
        const randomDelay = 2000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, randomDelay));
  
        document.body.style.minHeight = document.body.scrollHeight + 'px';
  
        const foundNewMovies = await scanForMovies();


        chrome.runtime.sendMessage({
          type: 'LOG',
          message: `Current movie count: ${movies.size}`,
          logType: 'info',
        });
  
        if (!foundNewMovies) {
          noNewMoviesCount++;
  
          // Send a reminder after half the max attempts
          if (!userScrollReminder && noNewMoviesCount >= Math.floor(maxNoNewMovies / 2)) {
            chrome.runtime.sendMessage({
              type: 'LOG',
              message: 'No new movies found. Please scroll the page manually to load more content.',
              logType: 'info',
            });
            userScrollReminder = true; // Ensure the reminder is sent only once
          }
  
          chrome.runtime.sendMessage({
            type: 'LOG',
            message: `No new movies found. Attempt ${noNewMoviesCount}/${maxNoNewMovies}`,
            logType: 'warning',
          });
        } else {
          noNewMoviesCount = 0;
          userScrollReminder = false; // Reset the reminder if new movies are found
        }
  
        if (noNewMoviesCount >= maxNoNewMovies) {
          chrome.runtime.sendMessage({
            type: 'LOG',
            message: 'No new movies found after multiple attempts. Collection complete.',
            logType: 'success',
          });
          break;
        }
  
        lastMovieCount = movies.size;
      }
  
      return Array.from(movies).map((movie) => {
        const [title, year] = movie.split(',');
        return { title, year };
      });
    }
  
    // Start the scraping process
    fetchAllMovies().then((movies) => {
      chrome.runtime.sendMessage({
        type: 'LOG',
        message: `Total movies collected: ${movies.length}`,
        logType: 'info',
      });
  
      movies.sort((a, b) => a.title.localeCompare(b.title));
  
      const BOM = '\uFEFF';
      const csvContent = BOM + "Title,Year\n" + movies
        .map((movie) => `"${movie.title.replace(/"/g, '""')}",${movie.year}`)
        .join("\n");
  
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `plex_movies_${movies.length}_${timestamp}.csv`;
  
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  
      chrome.runtime.sendMessage({
        type: 'LOG',
        message: `Movie collection complete! File saved as: ${filename}`,
        logType: 'success',
      });
    }).catch((error) => {
      chrome.runtime.sendMessage({
        type: 'LOG',
        message: `Error: ${error.message}`,
        logType: 'warning',
      });
    });
  }
  
  // Function to bridge between content script and popup
  function addLogToPopup(message, type = 'info') {
    chrome.runtime.sendMessage({ type: 'LOG', message, logType: type });
  }