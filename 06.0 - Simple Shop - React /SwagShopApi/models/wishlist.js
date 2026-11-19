const mongoose = require('mongoose');
const { Schema } = mongoose;
var ObjectId = mongoose.Schema.Types.ObjectId;

const wishListSchema = new Schema({
    title: {type: String, default:'cool wish list'},
    products:[{type:ObjectId, ref:'Product'}],// relationship with product table/collection
});

module.exports = mongoose.model('WishList',wishListSchema);