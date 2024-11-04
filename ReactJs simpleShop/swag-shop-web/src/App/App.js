import React, { Component } from 'react';
import logo from './logo.svg';
import './App.css';
//components
import Product from '../product/product';
import Wishlist from '../wishlist/wishlist';
//services
import HttpService from '../services/http-service';
const http = new HttpService();

class App extends Component{

  constructor(props){
    super(props);
    this.state ={products:[]}
    //.loadData=this.loadData.bind(this); //if it wasn't an arrow function then binding is required
    //this.loadData();
  }

  loadData=()=>{
    var self =this;
    http.getProducts()
    .then((res)=>{self.setState({products:res});})
    .catch((err)=>{console.log(err);});
    ;
  }
  productList=()=>{
    const list = this.state?.products?.map((product,index)=>{
      return(
        <div className='d-flex flex-sm-column flex-md-row flex-wrap justify-content-center' key={product._id}>
          <Product product={product} key={index} />
        </div>
      )
    })
    return list;
  }
  componentDidMount(){
    this.loadData();
  }
  render(){
    return ( 
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h2>Welcome to the shop</h2>
    
          <div className='container App-main '>
            <div className='container-fluid d-flex'>
              <div className='d-flex row flex-wrap col-12'>
                <div className='d-flex flex-sm-column col-sm-8 flex-md-row flex-wrap'>
                    {this.productList()}
                </div>
                <div className='col-sm-4 pt-1'>
                    <Wishlist/>
                </div>
      
              </div>
            {/* <div className='d-flex mx-auto flex-sm-column flex-md-row flex-wrap  justify-content-center'>
              {this.state?.products?.map((product,index)=>{
                  return <Product key={index} productDetails={{title:product.title,price:product.price,imgUrl:product.imgUrl}}/>
                })}
            </div> */}
            </div>

          </div>

        </header>
      </div>
    );
  }
}
// function App() { // read this for diffrences between function components and class components https://www.freecodecamp.org/news/function-component-vs-class-component-in-react/
//  to use constructor like functionalities in a function component we nned to use the life cycle hooks
//   useState to initialize the state of the object and the useEffect to run the code when the component mounts
//   return (
//     <div className="App">
//       <header className="App-header">
//         <img src={logo} className="App-logo" alt="logo" />
//         <h2>Welcome to React</h2>
//         <p>
//           Edit <code>src/App.js</code> and save to reload.
//         </p>
//         <a
//           className="App-link"
//           href="https://reactjs.org"
//           target="_blank"
//           rel="noopener noreferrer"
//         >
//           Learn React
//         </a>
//       </header>
//     </div>
//   );
// }

export default App;