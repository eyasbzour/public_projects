const express = require('express');
const mongoose = require('mongoose');
const ObjectId = require('mongoose').Types.ObjectId;

const Product = require('./models/product');
const WishList = require('./models/wishlist');
const dotEnv = require('dotenv');

dotEnv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:false}));

const port = process.env.PORT || 3000;
const dbName = process.env.dbName;


const dbUri = `dbUri`;
mongoose.connect(dbUri,{
    dbName:`${dbName}`,
    autoIndex: true
})
.then(() => {
    console.log('Connected to MongoDB Atlas');
})
.catch((err) => {
    console.error('Error connecting to MongoDB Atlas:', err);
});
 //Allow all requests from all domains & localhost
app.all('/*', function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET");
    next();
  });
  
app.post('/product',(request,response)=>{
   var product = new Product(); //or new product(request.body) assuming all the data is sent correctly
   //or we can specify each one like this new product({title:request.body.title,price: request.body.price ...etc})
    product.title = request.body.title;
    product.price = request.body.price;
    if(request.body.likes)
        product.likes = request.body.likes;
    
    product.save()
    .then((prod)=>{
        response.status(200).json({message:'product Saved', product : prod,});
    })
    .catch((err=>{
        response.status(500).json({error:'Could not create product',});
    }))

});
//printing all products
app.get('/products',(request,response)=>{
    Product.find()
    .then((res)=>{response.json(res)})
    .catch((error)=>{response.status(500).json({error:'Could not fetch product',})});
});

app.post('/wishlist',(request,response)=>{
    var wishList = new WishList();

     if(request.body.title)
        wishList.title = request.body.title;
     
     wishList.save()
     .then((newWishList)=>{
        response.status(200).json({message:'wishList Created', wishList : newWishList,});
     })
     .catch((err=>{
        response.status(500).json({error:'Could not create wishList',});
     }))
 
 });

 //printing all wishlists
 app.get('/wishlists',(request,response)=>{
    WishList.find().populate({path:'products',model:'Product'}).exec()
    .then((res)=>{response.json(res)})
    .catch((error)=>{response.status(500).json({error:'Could not fetch wishList'})});
 });       

app.put('/wishlist/product/add',(request,response)=>{
    Product.findOne({_id:request.body.productId })
    .then((prod)=>{
        console.log(prod._id);
        WishList.updateOne({_id:request.body.wishListId},
            {$addToSet:{ products:prod._id}})//updating a record using add to set because we only need the id and dont want duplicate data
        .then((newWishList)=>{
            console.log(newWishList);
        response.json({message:'wishList updated', wishlist:newWishList});
    })
        .catch((err)=>{response.status(500).json({error:'Could not add product to WishList'});});
    })
    .catch((error)=>{
        response.json({error:'Could not find product',});
    });
});

app.listen(port,()=>{
    console.log(`server is running on port ${port}`);
}); 
