import React,{Component} from "react";
import './productCondensed.css';

import DataService from "../../services/data-service";
const dataService = DataService.getInstance();

class ProductCondensed extends Component{
   constructor(props){
       super(props);
       this.product = props.product;
   }
   onWishlistRemove=()=>{
    dataService.removeWishlistItem(this.product);
   }
   render(){
       return(
           <li className="list-group-item d-flex justify-content-start ms-2">
             <button  onClick={this.onWishlistRemove} className="btn btn-outline-danger h-50 text-center">X</button>
             <p className="col-sm-8 ms-2 mb-0 text-center text-muted fs-5">{this.product.title +' | $'+ this.product.price}</p>
           </li>
       );
   }
}
export default ProductCondensed;