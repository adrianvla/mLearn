export const pageEntryElement  = (title, img_src)=>{
    let d = document.createElement("div");
    d.classList.add("page-entry");
    d.innerHTML = `<img src="${img_src}"><h1>${title}</h1>`;
    return d;
}

export const createAndAddPageEntry = (d, ...args) => {
    const el = pageEntryElement(...args);
    $(".sidebar",d).append(el);
    return el;
}
export const removeAllPageEntries = (d) => $(".sidebar .page-entry",d).remove();