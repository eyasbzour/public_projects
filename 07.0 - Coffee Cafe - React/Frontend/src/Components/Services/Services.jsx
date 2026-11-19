import React,{Component} from 'react';
import img1 from "../../assets/coffee2.png";

const ServicesData=[
    {
        "id": 1,
        img:img1,
        name:'Espresso',
        description:'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.Ut enim ad minim',
        aosDelay:100,
    },
    {
        "id": 2,
        img:img1,
        name:'Americano',
        description:'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit',
        aosDelay:300,
    },
    {
        "id": 3,
        img:img1,
        name:'Cappuccino',
        description:'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.Duis aute irure dolor in reprehenderit',
        aosDelay:500,
    }
]

class Services extends Component{
    render(){
        return (
            <>
            <span id='services'></span>
                <div className="services py-10">
                    <div className="container">
                        {/* header title */}
                        <div data-aos='fade-up'  className='text-center mb-20'> 
                            <h1 className="text-4xl font-bold font-cursive text-grey-800">
                                Best Coffee for You
                            </h1>
                        </div>
                        {/* Services Card Section */}
                        <div  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 place-items-center">

                            {
                                ServicesData.map((data,index)=>{
                                    return(
                                        <div
                                        data-aos='fade-up'
                                        data-aos-delay={data.aosDelay}
                                        key={index} className="services-card  group relative rounded-2xl bg-white hover:bg-primary hover:scale-105 hover:text-white shadow-xl duration-200 max-w-[300px]">
                                        {/* Image Section */}
                                            <div className='h-[122px]'>
                                                <img src={data.img} alt={data.title} className="max-w-[200px] block mx-auto transform -translate-y-14 group-hover:scale-110 group-hover:rotate-6 duration-300"/>
                                            </div>
                                        {/* Image Section */}
                                        <div className='p-4 text-center'>
                                            <h1 className="text-xl font-bold text-grey-800 group-hover:text-white">
                                                {data.name}
                                            </h1>
                                            <p className='text-left text-gray-500 group-hover:text-white duration-300 text-sm line-clamp-4'>
                                                {data.description}
                                            </p>
                                        </div>
                                        {/* Card Content */}

                                        </div>
                                    )
                                })
                            }
                        </div>
                    </div>
                </div>
            </>
        )
    }
}
export default Services;