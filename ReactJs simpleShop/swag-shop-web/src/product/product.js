 import React,{Component} from "react";
 import './product.css';

 import DataService from "../services/data-service";
 import NotificationService,{NOTIF_WISHLIST_CHANGED} from "../services/notification-service";

const dataService = DataService.getInstance();
const notifService =NotificationService.getInstance();

 class Product extends Component{
    

    constructor(props){
        super(props);
        this.product = props.product;
        this.state={
            prodTitle:this.product.title,
            onWishlist:dataService.isItemOnWishlist(this.product),
        }
    }
    componentDidMount(){
        notifService.addObserver(NOTIF_WISHLIST_CHANGED, this,this.onWishlistChanged)
    }
    componentWillUnmount(){
        notifService.removeObserver(NOTIF_WISHLIST_CHANGED, this);
    }
    onWishlistChanged=(newWishlist)=>{
        this.setState({onWishlist:dataService.isItemOnWishlist(this.product)})

    }
    onButtonClicked=()=>{
        if(this.state.onWishlist){
            dataService.removeWishlistItem(this.product);
        } else{
            dataService.addWishlistItem(this.product);
        }
    }
    render(){
        var btnClass;
        if(this.state.onWishlist){
            btnClass="btn btn-danger";
            }else{
                btnClass="btn btn-primary";
            }
        return(
            <div className="card product d-flex flex-column justify-content-between m-1" > 
                <img className="card-img-top mx-auto" style={{height:100+'px',width:100+'px'}} alt="Product" src={`${this.product.imgUrl}`}></img>
                <div className="card-body d-flex flex-column justify-content-between">
                    <h4 className="card-title mx-auto">{`${this.product.title}`}</h4>
                    <p className="card-text">Price: ${`${this.product.price}`}</p>
                    <button onClick={this.onButtonClicked} className={btnClass}>
                        {this.state.onWishlist?"Remove From Wishlist":"Add to Wishlist"}
                    </button>
                </div>
            </div>
        );
    }
 }
 export default Product;