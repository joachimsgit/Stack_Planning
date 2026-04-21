const getDataWithCache = (url, stateSetter, loadingSetter, cache) => {
  if (cache[url]) {
    stateSetter(cache[url]);
    loadingSetter(false);
  } else {
    fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    })
      .then((response) => response.json())
      .then((myJson) => {
        cache[url] = myJson;
        stateSetter(myJson);
        loadingSetter(false);
      })
      .catch(() => {
        loadingSetter(false);
      });
  }
};

const getData = (url, stateSetter) => {
  fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  })
    .then((response) => response.json())
    .then((myJson) => {
      stateSetter(myJson);
    })
    .catch(() => {});
};

const getDataWithLoading = (url, stateSetter, loadingSetter) => {
  fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  })
    .then((response) => response.json())
    .then((myJson) => {
      stateSetter(myJson);
      loadingSetter(false);
    })
    .catch(() => {
      loadingSetter(false);
    });
};

export { getDataWithCache, getData, getDataWithLoading };
