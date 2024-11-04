const postWishList= async(data)=>{
    try{
        const response = await fetch('http://localhost:3000/wishlist',{
            method:'POST',
            headers:{
                'Content-Type': 'application/json',
            },
            body:JSON.stringify(data),
        }
        );
        
        if(!response.ok){
            const errorMessage = await response.text();
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            console.error(`Response Body: ${errorMessage}`);
            throw new Error(`Request failed with status: ${response.status}`);
         }
            const responseData = await response.json();
            console.log(`Server response: ${JSON.stringify(responseData)}`);
    

    }
    catch(error){
        console.error("Error:", error.message);
    }
};

const putProdInWishList = async(data)=>{
    try{
        const response = await fetch('http://localhost:3000/wishlist/product/add',{
            method:'PUT',
            headers:{
                'Content-Type': 'application/json',
            },
            body:JSON.stringify(data),
        }
        );
        
        if(!response.ok){
            const errorMessage = await response.text();
            console.error(`HTTP Error: ${response.status} ${response.statusText}`);
            console.error(`Response Body: ${errorMessage}`);
            throw new Error(`Request failed with status: ${response.status}`);
         }
            const responseData = await response.json();
            console.log(`Server response: ${JSON.stringify(responseData)}`);
    

    }
    catch(error){
        console.error("Error:", error.message);
    }
};
// const wishListToAdd = {
//     title : 'Test Wish List',
// };
const prodIdToAdd = {
    productId:'67157ec2204bde92be12e486',
    wishListId:'6715870cda670fe56e64400e',
};
//postWishList(wishListToAdd);
putProdInWishList(prodIdToAdd);