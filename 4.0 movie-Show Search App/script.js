
const fetchSuggestions = (query) => {
  if (!query) {
    document.getElementById("suggestions").innerHTML = "";
    return;
  }
  
  fetch(`https://api.tvmaze.com/search/shows?q=${query}`)
    .then((response) => response.json())
    .then((data) => {
      const suggestionsContainer = document.getElementById("suggestions");
      suggestionsContainer.innerHTML = ""; // Clear previous suggestions
      
      data.forEach(item => {
        const suggestionItem = document.createElement("div");
        suggestionItem.textContent = item.show.name;
        suggestionItem.classList.add("suggestion-item");
        suggestionItem.onclick = () => {
          document.querySelector(".header_form-input").value = item.show.name;
          document.getElementById("suggestions").innerHTML = ""; // Clear suggestions
          get_movie(item.show.name); // Fetch movie details for the selected suggestion
        };
        suggestionsContainer.appendChild(suggestionItem);
      });
    })
    .catch((error) => {
      console.log(error.message);
    });
};

const search = (event) => {
  event.preventDefault();
  const value = document.querySelector(".header_form-input").value;
  get_movie(value);
  document.getElementById("suggestions").innerHTML = ""; // Clear suggestions
};

document.addEventListener("click", (event) => {
  const suggestionsContainer = document.getElementById("suggestions");
  if (!suggestionsContainer.contains(event.target) && !document.querySelector(".header_form-input").contains(event.target)) {
    suggestionsContainer.innerHTML = ""; // Clear suggestions
  }
});
const get_movie = (value = "Game of thrones") => {
    fetch(`https://api.tvmaze.com/singlesearch/shows?q=${value}&embed=episodes`)
      .then((response) => response.json())
      .then((data) => {
        if (data._embedded.episodes.length > 0) {
          const new_data = data._embedded.episodes.slice(0, 4);
  
          create_UI(data);
          return create_episodesUI(new_data);
        } else {
          return create_UI(data);
        }
      })
      .catch((error) => {
        console.log(error.message);
        // Challange: display your error here
      });
  };

 const create_UI = (data) => {
    const main_info = document.querySelector("#main_info");

    const movie_img = document.querySelector("#img_src");
    const movie_icon = document.querySelector("#img_icon");
    const movie_title = document.querySelector(".movie_title");
    const movie_desc = document.querySelector(".movie_desc");
    const movie_link = document.querySelector(".btn");
    const movie_date = document.querySelector("#movie_date");
    const movie_rating = document.querySelector("#movie_rating");
    const movie_runtime = document.querySelector("#movie_runtime");
    const movie_status = document.querySelector("#movie_status");
  
    // set the UI
    movie_icon.src = data.image.medium;
    movie_img.src = data.image.original;
    movie_title.textContent = data.name;
    movie_desc.innerHTML = data.summary;
    movie_link.href = data.officialSite;
    movie_date.textContent = data.premiered;
    movie_rating.textContent = data.rating.average;
    movie_runtime.textContent = data.runtime;
    movie_status.textContent = data.status;
    main_info.style['display']='block'
    };


  