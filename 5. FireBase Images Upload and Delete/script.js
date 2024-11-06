
var firebaseConfig = {
    apiKey: "YourApiKey",
    authDomain: "YourAuthDomain",
    databaseURL: "YourDatabaseURL",
    projectId: "YourProjectId",
    storageBucket: "YourStorageBucket",
    messagingSenderId: "YourMessagingSenderId",
    appId: "YourappId",
};
firebase.initializeApp(firebaseConfig);

// Function to show a modal with custom content for either a messege view or a confirmation view
function showCustomModal(title, message, type) {
    return new Promise((resolve) => {
        jQuery('#customModalLabel').text(title);
        if (type === "confirmation") {
            jQuery('#customModalBody').html(message);
            // Create buttons for delete and cancel
            var buttonsDiv = document.createElement("div");
            buttonsDiv.innerHTML = `
              <button id="modalConfirmButton" class="btn btn-danger">Delete</button>
              <button id="modalCancelButton" class="btn btn-secondary">Cancel</button>
            `;
            var modalFooter = document.getElementById('customModalFooter');
            //Clean up any elements in the footer
            modalFooter.innerHTML = "";
            //add the buttons to the footer
            modalFooter.appendChild(buttonsDiv);
            jQuery('#modalConfirmButton').on('click', function () {
                resolve(true);
                jQuery('#customModal').modal('hide');
            });
            jQuery('#modalCancelButton').on('click', function () {
                resolve(false);
                jQuery('#customModal').modal('hide');
            });
            jQuery('#customModal').on('hidden.bs.modal', function () {
                resolve(false);
            });
            jQuery('#customModal').modal('show');
        } else {
            jQuery('#customModalBody').html(message);
            // Create a Close button element
            var closeButtonDiv = document.createElement("div");
            closeButtonDiv.innerHTML = `
              <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
            `;
            var modalFooter = document.getElementById('customModalFooter');
            modalFooter.innerHTML = "";
            modalFooter.appendChild(closeButtonDiv);
            jQuery('#customModal').modal('show');
        }
    });
}

// Function to check if the browser is online
function isOnline() {
    return navigator.onLine;
}

// Function to handle online event
function handleOnline() {
    showCustomModal("", "Internet connection is restored.", "message");
}

// Function to handle offline event
function handleOffline() {
    showCustomModal("Error", "No internet connection.", "message");
}

// Listen for online and offline events to handle network changes
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

// Check the internet connection status when the page loads
if (!isOnline()) {
    handleOffline();
}

// Function to load images from Firebase and display in the carousel
function loadImagesToCarousel() {
    var carouselInner = document.querySelector(".carousel-inner");

    // Clear existing carousel items
    carouselInner.innerHTML = "";
    // Retrieve image data from Firebase
    firebase.database().ref("images").once("value")
        .then(function (images) {
            if (images.exists()) {
                images.forEach(
                    function (image) {
                        var imageName = image.key;
                        var imageData = image.val();

                        // Create a new carousel item
                        var carouselItem = document.createElement("div");
                        carouselItem.className = "carousel-item";

                        // Create an image element
                        var img = document.createElement("img");
                        img.src = "data:image/jpeg;base64," + imageData.imageBase64; // Set base64 image data as the image source
                        img.className = "d-block w-100";
                        img.alt = imageName;
                        // Add click event listener to show popup on image click
                        img.addEventListener("click", function (event) {
                            showImagePopoverMenu(event.target, imageName);
                        });

                        // Append the image to the carousel item
                        carouselItem.appendChild(img);
                        // Append the carousel item to the carousel inner container
                        carouselInner.appendChild(carouselItem);
                    });

                // Set the first item as active
                carouselInner.firstChild.classList.add("active");
            } else {
                // If no images in Firebase
                showCustomModal("Error", "No Images In Firebase, carouesl will be empty.", "message");
            }
        })
        .catch(function (error) {
            console.error("Error loading images from Firebase: ", error);
            // If there's an error connecting to Firebase
            showCustomModal("Error", "error in connecting to Firebase.", "message");
        });
}

// Function to show an image menu popover with custom content
function showImagePopoverMenu(imgElement, imageKey) {
    // Pause the carousel when the popover is shown
    var carousel = jQuery('#imageCarousel');
    carousel.carousel('pause');
    // Generate popover content
    var popoverContent = document.createElement("div");

    popoverContent.innerHTML = `
          <button id="popoverDeleteButton" class="btn btn-danger">Delete</button>
          <button id="popoverCancelButton" class="btn btn-secondary">Cancel</button>
        `;

    // popover menu 
    var imagePopover = jQuery(imgElement).popover({
        content: popoverContent,
        html: true,
        placement: 'top',
        trigger: 'focus',
    });

    // Resume carousel cycling when the popover is hidden 
    imagePopover.on('hidden.bs.popover', function () {
        carousel.carousel('cycle');
    });
    // Show popover menu 
    imagePopover.popover('toggle');

    // Hide the popover when clicking away or losing focus
    jQuery(document).on('click', function (e) {
        if (!jQuery(imgElement).is(e.target) && jQuery(imgElement).has(e.target).length === 0) {
            // Clicked outside the popover, hide it
            popoverHideAction(imgElement);
        }
    });
    // Handle Delete button click
    jQuery("#popoverDeleteButton").on("click", function () {
        // Call the deleteImage function 
        deleteImageFromFirebase(imgElement, imageKey);
    });
    jQuery("#popoverCancelButton").on("click", function () {
        // Call the popoverHideAction function 
        popoverHideAction(imgElement);
    });
}

// Function to delete an image from firebase
function deleteImageFromFirebase(imgElement, imageKey) {
    // Ask for confirmation on delete
    showCustomModal("Confirm", "Are you sure you want to delete this image?", "confirmation")
        .then(function (confirmation) {
            var isConfirmed = confirmation;
            if (isConfirmed) {
                var imageRef = firebase.database().ref(`images/${imageKey}`);
                imageRef.remove()
                    .then(function () {
                        var imagesRef = firebase.database().ref('images');
                        imagesRef.once('value').then(function (images) {
                            var updates = {};
                            var counter = 0;
                            // Shift the images down on deletion
                            images.forEach(function (image) {
                                var imageData = image.val();
                                var newImageKey = 'image' + counter;
                                updates[newImageKey] = imageData;
                                counter++;
                            });
                            updateCounterValue('delete', counter);
                            // Use set and not update to overwrite all images instead of update
                            imagesRef.set(updates);
                        });
                        popoverHideAction(imgElement);
                        loadImagesToCarousel();
                        showCustomModal("Success", "Image Deleted Successfuly", "message");
                    })
                    .catch(function (error) {
                        showCustomModal("Error", "`Error deleting image from Firebase:`" + error, "message");
                    }
                    )
            }
        });
}

// Function to cancel the image menu action
function popoverHideAction(imgElement) {
    jQuery(imgElement).popover('hide');
}

// Function to upload an image to Firebase
function uploadImage() {
    var fileInput = document.getElementById("imageInput");
    var file = fileInput.files[0];

    // Check if a file is selected
    if (file) {
        var reader = new FileReader();
        reader.onload = function (e) {

            var image = new Image();
            image.onload = function () {
                // Convert the image to an LED matrix
                var ledMatrix = convertImageToLEDMatrix(image);
                // set the file name + the counter value
                var ImageName = file.name;
                ImageName = ImageName.replace(/\.[^.]+$/, "");
                ImageName = ImageName.replace(/[^a-zA-Z0-9]/g, "");

                // Convert LED matrix array to a JSON string
                var ledMatrixString = JSON.stringify(ledMatrix).replace(/[\[\]]/g, "");

                var imageArray = {};
                //Get the counter value from database
                firebase.database().ref("imageCounter").once("value")
                    .then(function (imageCounterValue) {
                        var counterValue = imageCounterValue.val();
                        var fileName = "image" + counterValue; // image0 image1 image2
                        imageArray[fileName] = {
                            ImageName: ImageName,
                            imageBase64: e.target.result.split(",")[1],// Get base64 portion of data URL
                            ledMatrix: ledMatrixString, // Store the LED matrix as a string
                            imageWidth: image.naturalWidth
                        };
                        // Store the image data in the database
                        firebase.database().ref("images").update(imageArray)
                            .then(function () {
                                // Update Counter Value in the database
                                updateCounterValue('add', counterValue);
                                // Handle File Preview After Upload 
                                previewImage("upload");
                                // Reload images to update the carousel
                                loadImagesToCarousel();
                                console.log("LED Matrix uploaded successfully!");

                                //Show Custom Modal With success Message
                                showCustomModal('Success', 'LED Matrix and image data uploaded successfully!', 'message');
                            })
                            .catch(function (error) {
                                console.error("Error uploading image: ", error);
                            });
                    })
                    .catch(function (error) {
                        console.error("Error:", error);
                    });
            };
            image.src = e.target.result;
        };
        // Read the file as a data URL
        reader.readAsDataURL(file);
        return; // Exit the function 
    } else {
        console.error("No file selected!");
        // Show Custom Modal With Error Message
        showCustomModal('Error', 'No file selected!', 'message');
        return; // Exit the function 
    }
}

// Function to convert Image to LED Matrix (Black and White)
function convertImageToLEDMatrix(image) {
    var canvas = document.createElement("canvas");

    var pngHeight = 12;
    var pngWidth = image.naturalWidth;

    canvas.width = pngWidth;
    canvas.height = pngHeight;
    var ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0, pngWidth, pngHeight);
    var imageData = ctx.getImageData(0, 0, pngWidth, pngHeight).data;

    var bwMatrix = [];

    var index = 0;
    for (var x = 0; x < pngWidth; x++) {
        bwMatrix[x] = [];
        for (var y = 0; y < pngHeight; y++) {

            var red = imageData[index];
            var green = imageData[index + 1];
            var blue = imageData[index + 2];
            //use gray scale to decide if the value is 0 or 1 where white will evalute to 0 and black to 1
            var grayscale = (0.3 * red + 0.59 * green + 0.11 * blue);
            bwMatrix[x][y] = (grayscale > 128) ? 0 : 1;

            index += 4;
        }
    }
    return bwMatrix;
}

// Function to reset file Preview 
function resetFilePreview() {
    var fileInput = document.getElementById("imageInput");
    var fileNameElement = document.getElementById("fileName");
    var filePreviewElement = document.getElementById("filePreview");

    filePreviewElement.src = "";
    fileInput.value = null;
    filePreviewElement.style.visibility = "hidden";
    fileNameElement.textContent = "Please upload an image!";
}

// Function to preview the selected image
function previewImage(action) {

    var fileInput = document.getElementById("imageInput");
    var fileNameElement = document.getElementById("fileName");
    var filePreviewElement = document.getElementById("filePreview");

    if (fileInput.files && fileInput.files[0]) {
        var file = fileInput.files[0];

        // Check if the selected file is an image
        if (file.type.startsWith("image/")) {
            var reader = new FileReader();
            reader.onload = function (e) {
                var image = new Image();

                image.onload = function () {

                filePreviewElement.src = e.target.result;
                filePreviewElement.style.visibility = "visible";

                if (action == "preview") {
                    fileNameElement.textContent = "Image to upload: " + file.name;
                }
                else if (action == "upload") {
                    fileNameElement.textContent = "Image Uploaded: " + file.name;
                    fileInput.value = null;
                }

                };

                image.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            // Reset the preview if the selected file is not an image
            resetFilePreview();

            console.error("Selected file is not an image!");
            // Show Custom Modal With Error Message
            showCustomModal('Error', 'Selected file is not an image!, Please select an image file!', "message");
        }
    } else {
        // Reset the preview if no file is selected
        resetFilePreview();
    }
}

// Function Update the counter value by 1 and when it reaches 2 it resets
function updateCounterValue(action, value) {
    firebase.database().ref("imageCounter").transaction(
        function (currentValue) {
            if (action == "add") {
                if (currentValue === 2) {
                    return 0;
                } else {
                    return currentValue + 1;
                }
            } else {
                return value;
            }
        }).then(function (transactionResult) {
            console.log("Transaction Result:", transactionResult);
        })
        .catch(function (error) {
            console.error("Error during transaction:", error);
        });
}

function LoadLogoImageFromFirebase() {
    var uploadedImage = document.getElementById("LogoImage");

    //Retrieve logo image data from Firebase
    firebase.database().ref("LogoImage").once("value")
        .then(function (image) {
            var imageData = image.val();
            if (imageData) {
                uploadedImage.src = "data:image/jpeg;base64," + imageData.imageBase64;
                uploadedImage.style.visibility = "visible";
            } else {
                console.error("Image not found in Firebase.");
            }
        })
        .catch(function (error) {
            console.error("Error loading image from Firebase: ", error);
        });
}

// Load logo image on page load
LoadLogoImageFromFirebase();
// Load images to the carousel on page load
loadImagesToCarousel();