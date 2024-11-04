import React ,{ Component } from "react";
import './wishlist.css'

import NotificationService,{NOTIF_WISHLIST_CHANGED} from "../services/notification-service";

import ProductCondensed from "./productCondensed/productCondensed";

const notifService = NotificationService.getInstance();

class Wishlist extends Component{
    constructor(props){
        super(props);
        this.state = {
            wishlist: []
        }
    }

    createWishlist =()=>{
        const wishlist = this.state.wishlist.map((product,index)=>{
            return(
                <ProductCondensed  product={product}  key={index+''+product?._id}/>
            )
        });
        return wishlist;
    }
    componentDidMount(){
        notifService.addObserver(NOTIF_WISHLIST_CHANGED,this,this.onWishlistChanged);
    }
    componentWillUnmount(){
        notifService.removeObserver(NOTIF_WISHLIST_CHANGED,this);
    }
    onWishlistChanged=(newWishlist)=>{ 
        this.setState({wishlist:newWishlist})
    }

    render(){
        return(
            <div className="card">
                <div className="card-body">
                    <h4 className="card-title">Wishlist</h4>
                    <ul className="list-group list-group-flush d-flex flex-column justify-content-between">
                        {this.createWishlist()}
                    </ul>
                </div>
            </div>
        )
    }
}

export default Wishlist;
