(() => {
  const $ = s => document.querySelector(s);
  const filesEl = $("#files");
  const state = { files: [] };

  function render() {
    filesEl.innerHTML = "";
    state.files.forEach((f, i) => {
      const d = document.createElement("div");
      d.className = "fileCard";
      d.textContent = `${i+1}. ${f.name}`;
      filesEl.appendChild(d);
    });
  }

  function addFileWithPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const file = input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      state.files.push({ name: file.name, file });
      render();
    }, { once: true });

    input.click();
  }

  $("#addFileBtn").addEventListener("click", addFileWithPicker);
})();
