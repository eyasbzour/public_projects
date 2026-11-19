export const NOTIF_WISHLIST_CHANGED='notif_wishlist_changed';

class NotificationService {
    static #instance = null;
    // static observers = {};
    #observers = new Map();

    constructor(){
        if(!NotificationService.#instance){
           NotificationService.#instance = this;
        }
    }
    addObserver =(notifName,observer,callBack)=>{
        // let obs = this.observers[notifName];
        // if(!obs){
        //     this.observers[notifName] = [];
        // }
        // let notifObj = {observer:observer, callBack:callBack};
        // this.observers[notifName].push(notifObj);
        if (!this.#observers.has(notifName)) {
            this.#observers.set(notifName, []);
        }
        this.#observers.get(notifName).push({ observer, callBack });
    }
    removeObserver=(notifName, observer)=>{
        
        // let obs = this.observers[notifName];
        // if(obs){
        //     obs = obs.filter((notifObj)=>notifObj.observer !== observer);
        //     this.observers[notifName] = obs;
        // }
        const obs = this.#observers.get(notifName);
        if (obs) {
            const filteredObs = obs.filter(notifObj => notifObj.observer !== observer);
            this.#observers.set(notifName,filteredObs);            
        }

    }
    notify=(notifName,data)=>{
        // let obs = this.observers[notifName];
        // if(obs){
        //     obs.forEach(notifObj=>{
            //         notifObj.callBack(data);
            //     });
            // }
        const obs = this.#observers.get(notifName);
        // if (obs) {
        //     obs.forEach(
        //         ({callBack})=>callBack(data)  //destructered      
        //     );
        // }
        if (obs) {
            obs.forEach(notifObj => {
                try {
                    notifObj.callBack?.(data);
                } catch (error) {
                    console.error(`Error notifying observer: ${error}`);
                }
            });
        }
        
    }
    static getInstance(){
        if (!NotificationService.#instance) {
            NotificationService.#instance = new NotificationService(); // Create if it doesn't exist
        }
        return NotificationService.#instance; // Return the singleton instance
    }
}
export default NotificationService;