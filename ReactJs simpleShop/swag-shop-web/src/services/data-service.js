import NotificationService, { NOTIF_WISHLIST_CHANGED } from "./notification-service";
const notifService = NotificationService.getInstance();

class DataService {
    static #instance = null;
    #wishlist = []; // Make wishlist private

    constructor() {
        if (!DataService.#instance) {
            DataService.#instance = this;
        }
    }

    addWishlistItem(item) {
        if(!this.#wishlist.includes(item,0)){
            this.#wishlist.push(item); // Access static wishlist
            notifService.notify(NOTIF_WISHLIST_CHANGED,this.#wishlist);
        } else{
            alert(`product : ${item.title} is already in wishlist`)
        }
       
    }

    removeWishlistItem(item) {
        if(this.#wishlist.includes(item, 0)){
           // this.#wishlist.splice(this.#wishlist.indexOf(item), 1);
            this.#wishlist = this.#wishlist.filter(itm => itm._id !== item._id);
            notifService.notify(NOTIF_WISHLIST_CHANGED,this.#wishlist);
        }

    } 
    isItemOnWishlist=(item)=>{
        return this.#wishlist.includes(item,0);
    }
    static getInstance() {
        if (!DataService.#instance) {
            DataService.#instance = new DataService(); // Create if it doesn't exist
        }
        return DataService.#instance; // Return the singleton instance
    }

    getWishlist() { // Optional: method to retrieve the wishlist
        return [...this.#wishlist];
    }
}

export default DataService;
