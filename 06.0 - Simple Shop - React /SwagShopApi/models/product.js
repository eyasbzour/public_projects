const mongoose = require('mongoose');
const { Schema } = mongoose;// or const Schema = mongoose.Schema
// Define a schema for a collection, e.g., Products

const productSchema = new Schema({
    title: String,
    price: Number,
    likes:{type:Number,default:0},
});

module.exports = mongoose.model('Product',productSchema);