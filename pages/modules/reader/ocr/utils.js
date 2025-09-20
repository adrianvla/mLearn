export const blobToDataURL = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        resolve(reader.result);
        console.log("blobToDataURL", reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});